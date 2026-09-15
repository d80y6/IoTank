-- Migration: Revoke anonymous EXECUTE on public functions
-- Date: 2026-04-28
-- Purpose: Prevent the `anon` role from calling SECURITY DEFINER functions

BEGIN;

-- Revoke EXECUTE for the anonymous role on all functions in the public schema
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- OPTIONAL: If you also want to block signed-in users from calling any functions
-- via the `authenticated` role, uncomment the following line and run it intentionally:
-- REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- Prevent future default grants to anon (run as the role that created objects):
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

COMMIT;

-- Notes:
-- 1) After running this migration, re-grant `EXECUTE` only to functions that must remain public:
--    GRANT EXECUTE ON FUNCTION public.some_public_fn() TO anon;
-- 2) To convert a function to SECURITY INVOKER (if it doesn't require elevated privileges):
--    ALTER FUNCTION public.some_fn(argtypes) SECURITY INVOKER;
-- 3) To move sensitive functions out of `public`, create an `internal` schema and recreate/move them there.
