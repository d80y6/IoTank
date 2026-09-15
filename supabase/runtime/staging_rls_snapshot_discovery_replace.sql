-- Part 0: Preflight & discovery of existing backup tables (avoid schema mismatches)
CREATE SCHEMA IF NOT EXISTS supabase_backups;

DO $$
DECLARE
  policy_cols text;
  function_cols text;
  has_policy_table boolean := FALSE;
  has_function_table boolean := FALSE;
BEGIN
  SELECT to_regclass('supabase_backups.policy_backups') IS NOT NULL INTO has_policy_table;
  SELECT to_regclass('supabase_backups.function_backups') IS NOT NULL INTO has_function_table;

  IF has_policy_table THEN
    SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) INTO policy_cols
    FROM information_schema.columns
    WHERE table_schema = 'supabase_backups' AND table_name = 'policy_backups';
    RAISE NOTICE 'Found existing supabase_backups.policy_backups with columns: %', COALESCE(policy_cols, '(none)');
  ELSE
    RAISE NOTICE 'No existing supabase_backups.policy_backups table found.';
  END IF;

  IF has_function_table THEN
    SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) INTO function_cols
    FROM information_schema.columns
    WHERE table_schema = 'supabase_backups' AND table_name = 'function_backups';
    RAISE NOTICE 'Found existing supabase_backups.function_backups with columns: %', COALESCE(function_cols, '(none)');
  ELSE
    RAISE NOTICE 'No existing supabase_backups.function_backups table found.';
  END IF;
END$$;

-- Create new snapshot tables (v2) to avoid colliding with older/unknown schemas
CREATE TABLE IF NOT EXISTS supabase_backups.policy_backups_v2 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  schema_name text,
  tablename text,
  polname text,
  using_expr text,
  withcheck_expr text,
  raw jsonb
);

CREATE TABLE IF NOT EXISTS supabase_backups.function_backups_v2 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  nspname text,
  proname text,
  definition text
);

-- Populate v2 snapshot tables (guarded so failures won't abort everything)
DO $$
BEGIN
  BEGIN
    INSERT INTO supabase_backups.policy_backups_v2 (schema_name, tablename, polname, using_expr, withcheck_expr, raw)
    SELECT n.nspname, c.relname, p.polname,
           pg_get_expr(p.polqual, p.polrelid),
           pg_get_expr(p.polwithcheck, p.polrelid),
           to_jsonb(p.*)
    FROM pg_policy p
    JOIN pg_class c ON p.polrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Failed to snapshot policies into policy_backups_v2: %', SQLERRM;
  END;

  BEGIN
    INSERT INTO supabase_backups.function_backups_v2 (nspname, proname, definition)
    SELECT n.nspname, p.proname, pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname IN ('public', 'auth');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Failed to snapshot functions into function_backups_v2: %', SQLERRM;
  END;
END$$;

-- Verify snapshot counts
SELECT 'policy_snapshot_v2' AS item, max(snapshot_at) AS ts, count(*) as policies_backed_up FROM supabase_backups.policy_backups_v2;
SELECT 'function_snapshot_v2' AS item, max(snapshot_at) AS ts, count(*) as functions_backed_up FROM supabase_backups.function_backups_v2;

-- Part 1: Discovery queries — run these and review the results
-- 1) Tables with "client" in the name
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name ILIKE '%client%'
ORDER BY table_schema, table_name;

-- 2) Tables that have a client_id column
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE column_name = 'client_id'
ORDER BY table_schema, table_name;

-- 3) Tables that have firebase_uid / supabase_uid (or similar) columns
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE column_name IN ('firebase_uid','supabase_uid','supabase_id','supabase_user_id')
ORDER BY table_schema, table_name;

-- 4) Foreign keys referencing client_billing (if present)
SELECT tc.table_schema, tc.table_name, kcu.column_name,
       ccu.table_schema AS foreign_schema, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND (ccu.table_name ILIKE '%client_billing%' OR ccu.table_name ILIKE '%client%')
ORDER BY tc.table_schema, tc.table_name;

-- 5) Policies that mention client_billing, firebase_uid, supabase_uid, or auth.uid
SELECT c.relname AS table_name, p.polname,
       pg_get_expr(p.polqual,p.polrelid) AS using_expr,
       pg_get_expr(p.polwithcheck,p.polrelid) AS with_check
FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
WHERE pg_get_expr(p.polqual,p.polrelid) ILIKE '%client_billing%'
   OR pg_get_expr(p.polqual,p.polrelid) ILIKE '%firebase_uid%'
   OR pg_get_expr(p.polqual,p.polrelid) ILIKE '%supabase_uid%'
   OR pg_get_expr(p.polqual,p.polrelid) ILIKE '%auth.uid%';

-- 6) Functions whose source mentions those identifiers
SELECT n.nspname, p.proname, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE pg_get_functiondef(p.oid) ILIKE '%firebase_uid%'
   OR pg_get_functiondef(p.oid) ILIKE '%client_billing%'
   OR pg_get_functiondef(p.oid) ILIKE '%supabase_uid%'
   OR pg_get_functiondef(p.oid) ILIKE '%auth.uid%';

-- Part 2: Safe replacements — conditional and idempotent.
-- Each EXECUTE is wrapped to avoid aborting the whole script on missing objects
DO $$
DECLARE
  has_client_billing boolean := FALSE;
  has_client_billing_supabase_uid boolean := FALSE;
  has_get_user_client_id boolean := FALSE;
  has_market_client_id boolean := FALSE;
  view_using text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='client_billing') INTO has_client_billing;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='client_billing' AND column_name='supabase_uid') INTO has_client_billing_supabase_uid;
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_client_id') INTO has_get_user_client_id;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='market_signals' AND column_name='client_id') INTO has_market_client_id;

  -- MARKET_SIGNALS: prefer client_billing.supabase_uid, fallback to get_user_client_id()
  IF to_regclass('public.market_signals') IS NOT NULL THEN
    IF has_client_billing AND has_client_billing_supabase_uid AND has_market_client_id THEN
      RAISE NOTICE 'Applying supabase_uid-based policies for public.market_signals';
      BEGIN
        EXECUTE 'DROP POLICY IF EXISTS "Clients can view own market signals" ON public.market_signals';
        EXECUTE 'CREATE POLICY "Clients can view own market signals" ON public.market_signals FOR SELECT TO authenticated USING (client_id IN (SELECT id FROM public.client_billing WHERE supabase_uid::uuid = auth.uid()) OR client_id IS NULL)';
        EXECUTE 'DROP POLICY IF EXISTS "Clients can insert market signals" ON public.market_signals';
        EXECUTE 'CREATE POLICY "Clients can insert market signals" ON public.market_signals FOR INSERT TO authenticated WITH CHECK (client_id IN (SELECT id FROM public.client_billing WHERE supabase_uid::uuid = auth.uid()) OR client_id IS NULL)';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'market_signals supabase_uid-based policy creation failed: %', SQLERRM;
      END;
    ELSIF has_get_user_client_id AND has_market_client_id THEN
      RAISE NOTICE 'Applying get_user_client_id()-based policies for public.market_signals';
      BEGIN
        EXECUTE 'DROP POLICY IF EXISTS "Clients can view own market signals" ON public.market_signals';
        EXECUTE 'CREATE POLICY "Clients can view own market signals" ON public.market_signals FOR SELECT TO authenticated USING (client_id = public.get_user_client_id() OR client_id IS NULL)';
        EXECUTE 'DROP POLICY IF EXISTS "Clients can insert market signals" ON public.market_signals';
        EXECUTE 'CREATE POLICY "Clients can insert market signals" ON public.market_signals FOR INSERT TO authenticated WITH CHECK (client_id = public.get_user_client_id() OR client_id IS NULL)';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'market_signals get_user_client_id-based policy creation failed: %', SQLERRM;
      END;
    ELSE
      RAISE NOTICE 'Skipping market_signals policy changes: missing client_billing.supabase_uid or get_user_client_id() or market_signals.client_id.';
    END IF;
  ELSE
    RAISE NOTICE 'Skipping market_signals: table not found';
  END IF;

  -- TANKS: prefer per-row supabase_uid mapping; otherwise warn if firebase_uid still present
  IF to_regclass('public.tanks') IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tanks' AND column_name='supabase_uid') THEN
      RAISE NOTICE 'Applying supabase_uid-based policies for public.tanks';
      view_using := 'supabase_uid::uuid = auth.uid()';
      IF has_get_user_client_id THEN
        view_using := view_using || ' OR client_id = public.get_user_client_id() OR client_id IS NULL';
      ELSE
        view_using := view_using || ' OR client_id IS NULL';
      END IF;
      BEGIN
        EXECUTE 'DROP POLICY IF EXISTS "Users can update own tanks" ON public.tanks';
        EXECUTE 'CREATE POLICY "Users can update own tanks" ON public.tanks FOR UPDATE TO authenticated USING (supabase_uid::uuid = auth.uid()) WITH CHECK (supabase_uid::uuid = auth.uid())';
        EXECUTE format('DROP POLICY IF EXISTS "Users can view own tanks" ON public.tanks');
        EXECUTE format('CREATE POLICY "Users can view own tanks" ON public.tanks FOR SELECT TO authenticated USING (%s)', view_using);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'tanks policy update failed: %', SQLERRM;
      END;
    ELSIF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tanks' AND column_name='firebase_uid') THEN
      RAISE NOTICE 'public.tanks still references firebase_uid; manual migration to supabase_uid required before automated replacement.';
    ELSE
      RAISE NOTICE 'public.tanks missing supabase_uid/firebase_uid; skipping tanks policy update.';
    END IF;
  END IF;

  -- ALERTS: similar to tanks
  IF to_regclass('public.alerts') IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='alerts' AND column_name='supabase_uid') THEN
      RAISE NOTICE 'Applying supabase_uid-based policies for public.alerts';
      view_using := 'supabase_uid::uuid = auth.uid()';
      IF has_get_user_client_id THEN
        view_using := view_using || ' OR client_id = public.get_user_client_id() OR client_id IS NULL';
      ELSE
        view_using := view_using || ' OR client_id IS NULL';
      END IF;
      BEGIN
        EXECUTE 'DROP POLICY IF EXISTS "Users can update own alerts" ON public.alerts';
        EXECUTE 'CREATE POLICY "Users can update own alerts" ON public.alerts FOR UPDATE TO authenticated USING (supabase_uid::uuid = auth.uid()) WITH CHECK (supabase_uid::uuid = auth.uid())';
        EXECUTE format('DROP POLICY IF EXISTS "Users can view own alerts" ON public.alerts');
        EXECUTE format('CREATE POLICY "Users can view own alerts" ON public.alerts FOR SELECT TO authenticated USING (%s)', view_using);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'alerts policy update failed: %', SQLERRM;
      END;
    ELSIF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='alerts' AND column_name='firebase_uid') THEN
      RAISE NOTICE 'public.alerts still references firebase_uid; manual migration to supabase_uid required before automated replacement.';
    ELSE
      RAISE NOTICE 'public.alerts missing supabase_uid/firebase_uid; skipping alerts policy update.';
    END IF;
  END IF;

  -- Generic scan: output policies that still mention firebase_uid for manual review
  FOR rec IN
    SELECT c.relname AS tbl, p.polname AS pol, pg_get_expr(p.polqual,p.polrelid) AS using_expr
    FROM pg_policy p
    JOIN pg_class c ON p.polrelid = c.oid
    WHERE pg_get_expr(p.polqual,p.polrelid) ILIKE '%firebase_uid%'
  LOOP
    RAISE NOTICE 'Policy uses firebase_uid: table=% pol=% using=%', rec.tbl, rec.pol, rec.using_expr;
  END LOOP;

  PERFORM pg_notify('pgrst','reload schema');
END$$;

-- End of script
-- Run this file in staging, review the SELECT outputs above, and re-run as needed.
