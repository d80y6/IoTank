-- rls_and_stackdepth_fixes.sql
-- Safe runtime fixes for RLS recursion / stack-depth and market_signals permissions
-- This script is defensive: it checks for the presence of tables/columns/functions
-- before trying to create policies that reference them. Run in staging first.

-- 1) Create non-recursive helper functions only if `system_users` exists
DO $$
BEGIN
  IF to_regclass('public.system_users') IS NOT NULL THEN
    -- Create SECURITY DEFINER helpers used by policies (safe to replace)
    CREATE OR REPLACE FUNCTION public.check_is_super_admin()
    RETURNS BOOLEAN
    SECURITY DEFINER
    SET search_path = public, auth
    STABLE
    AS $fn$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM public.system_users
        WHERE auth_user_id = auth.uid()
          AND role = 'super_admin'
          AND is_active = TRUE
      );
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION public.check_is_staff()
    RETURNS BOOLEAN
    SECURITY DEFINER
    SET search_path = public, auth
    STABLE
    AS $fn$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM public.system_users
        WHERE auth_user_id = auth.uid()
          AND is_active = TRUE
      );
    END;
    $fn$ LANGUAGE plpgsql;
  ELSE
    RAISE NOTICE 'Skipping helper functions: public.system_users not found.';
  END IF;
END$$;

-- 2) Create/replace policies only when dependent tables/columns exist.
DO $$
BEGIN
  -- Tanks update policy (requires tanks table and firebase_uid column)
  IF to_regclass('public.tanks') IS NOT NULL THEN
    IF EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tanks' AND column_name = 'firebase_uid'
    ) THEN
      EXECUTE 'DROP POLICY IF EXISTS "Users can update own tanks" ON public.tanks';
      EXECUTE 'CREATE POLICY "Users can update own tanks" ON public.tanks FOR UPDATE TO authenticated USING (public.firebase_uid() = firebase_uid) WITH CHECK (public.firebase_uid() = firebase_uid)';
    ELSE
      RAISE NOTICE 'Skipping tanks policy: column firebase_uid not found on public.tanks';
    END IF;
  ELSE
    RAISE NOTICE 'Skipping tanks policy: public.tanks table not found';
  END IF;

  -- Alerts update policy (requires alerts table and firebase_uid column)
  IF to_regclass('public.alerts') IS NOT NULL THEN
    IF EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'alerts' AND column_name = 'firebase_uid'
    ) THEN
      EXECUTE 'DROP POLICY IF EXISTS "Users can update own alerts" ON public.alerts';
      EXECUTE 'CREATE POLICY "Users can update own alerts" ON public.alerts FOR UPDATE TO authenticated USING (public.firebase_uid() = firebase_uid) WITH CHECK (public.firebase_uid() = firebase_uid)';
    ELSE
      RAISE NOTICE 'Skipping alerts policy: column firebase_uid not found on public.alerts';
    END IF;
  ELSE
    RAISE NOTICE 'Skipping alerts policy: public.alerts table not found';
  END IF;

  -- Market signals policies: only create if market_signals and client_billing and firebase_uid column exist
  IF to_regclass('public.market_signals') IS NOT NULL THEN
    IF to_regclass('public.client_billing') IS NOT NULL AND EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'client_billing' AND column_name = 'firebase_uid'
    ) THEN
      EXECUTE 'DROP POLICY IF EXISTS "Clients can view own market signals" ON public.market_signals';
      EXECUTE 'CREATE POLICY "Clients can view own market signals" ON public.market_signals FOR SELECT TO authenticated USING (client_id IN (SELECT id FROM public.client_billing WHERE firebase_uid = public.firebase_uid()) OR client_id IS NULL)';

      EXECUTE 'DROP POLICY IF EXISTS "Clients can insert market signals" ON public.market_signals';
      EXECUTE 'CREATE POLICY "Clients can insert market signals" ON public.market_signals FOR INSERT TO authenticated WITH CHECK (client_id IN (SELECT id FROM public.client_billing WHERE firebase_uid = public.firebase_uid()) OR client_id IS NULL)';
    ELSE
      RAISE NOTICE 'Skipping market_signals policies: client_billing or firebase_uid column not found; confirm identity mapping before creating policies.';
    END IF;
  ELSE
    RAISE NOTICE 'Skipping market_signals policies: public.market_signals table not found';
  END IF;

  -- Signal PostgREST reload (no-op if pgrst not listening)
  PERFORM pg_notify('pgrst', 'reload schema');
END$$;

-- Diagnostic queries (run separately in SQL editor to inspect current state)
-- 1) List public policies and expressions:
-- SELECT p.polname, c.relname AS tablename,
--        pg_get_expr(p.polqual, p.polrelid) AS using_expr,
--        pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck_expr
-- FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
-- WHERE c.relnamespace = 'public'::regnamespace
-- ORDER BY c.relname, p.polname;

-- 2) Fetch function sources for suspicious functions:
-- SELECT n.nspname, p.proname, pg_get_functiondef(p.oid)
-- FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE p.proname ILIKE '%get_user_bundle_v2%' OR p.proname ILIKE '%prevent_audit_tampering%';

-- End of script
