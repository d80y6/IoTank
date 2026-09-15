-- =============================================================================
-- 20260511999999_fix_realtime_rls_recursion.sql
-- =============================================================================
-- PURPOSE:
--   Realtime subscriptions to `tanks` and `alerts` trigger
--   `realtime.subscription_check_filters`, which calls `has_column_privilege`,
--   which evaluates each table's RLS policies. Those policies subquery
--   `profiles`, which itself has its own RLS policies, causing a recursive
--   permission-check chain that hits Postgres's stack depth limit (54001).
--
-- FIX:
--   Replace the subquery on `profiles` in tanks/alerts RLS policies with a
--   dedicated SECURITY DEFINER function that reads `profiles` without
--   triggering its own RLS evaluation. This breaks the recursion.
--
-- SCOPE: All changes are in `public` schema; `postgres` user has full access.
-- SAFE:  All steps are idempotent (CREATE OR REPLACE, DROP IF EXISTS).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Create a stable, SECURITY DEFINER helper that fetches the
--         calling user's station_id directly, bypassing profiles RLS.
--         This is safe because it only returns data for auth.uid().
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_station_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  v_station_id UUID;
BEGIN
  SELECT station_id INTO v_station_id
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
  RETURN v_station_id;
END;
$$;

-- Revoke public execute, grant only to authenticated
REVOKE EXECUTE ON FUNCTION public.get_my_station_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_station_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_station_id() TO service_role;

-- -----------------------------------------------------------------------------
-- Step 2: Rebuild tanks RLS policy using the non-recursive helper.
--         Old policy subqueried profiles → triggered profiles RLS → recursion.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Consolidated tanks access" ON public.tanks;

CREATE POLICY "Consolidated tanks access"
  ON public.tanks
  FOR ALL
  TO authenticated
  USING (
    station_id = public.get_my_station_id()
    OR (SELECT public.check_is_staff())
  )
  WITH CHECK (
    station_id = public.get_my_station_id()
    OR (SELECT public.check_is_super_admin())
  );

-- -----------------------------------------------------------------------------
-- Step 3: Rebuild alerts RLS policy using the same non-recursive helper.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Consolidated alerts access" ON public.alerts;

CREATE POLICY "Consolidated alerts access"
  ON public.alerts
  FOR ALL
  TO authenticated
  USING (
    station_id = public.get_my_station_id()
    OR (SELECT public.check_is_staff())
  )
  WITH CHECK (
    station_id = public.get_my_station_id()
    OR (SELECT public.check_is_super_admin())
  );

-- -----------------------------------------------------------------------------
-- Step 4: Fix market_signals 403 errors.
--         Use auth.uid()-based lookup via client_billing instead of
--         the recursive firebase_uid pattern.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.market_signals') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Clients can view own market signals" ON public.market_signals;
    DROP POLICY IF EXISTS "Clients can insert market signals"   ON public.market_signals;
    DROP POLICY IF EXISTS "market_signals_select"              ON public.market_signals;
    DROP POLICY IF EXISTS "market_signals_insert"              ON public.market_signals;

    -- SELECT: own station signals (via get_my_station_id helper - non-recursive)
    EXECUTE '
      CREATE POLICY "market_signals_select"
        ON public.market_signals
        FOR SELECT
        TO authenticated
        USING (
          station_id = public.get_my_station_id()
          OR (SELECT public.check_is_staff())
        )
    ';

    -- INSERT: only for own station
    EXECUTE '
      CREATE POLICY "market_signals_insert"
        ON public.market_signals
        FOR INSERT
        TO authenticated
        WITH CHECK (
          station_id = public.get_my_station_id()
          OR (SELECT public.check_is_super_admin())
        )
    ';

    RAISE NOTICE 'market_signals RLS policies updated.';
  ELSE
    RAISE NOTICE 'market_signals table not found, skipping.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Step 5: Signal PostgREST to reload schema
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;
