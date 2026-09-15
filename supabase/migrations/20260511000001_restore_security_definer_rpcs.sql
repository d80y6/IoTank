-- supabase/migrations/20260511000001_restore_security_definer_rpcs.sql
-- ============================================================================
-- HOTFIX: Restore SECURITY DEFINER on RPCs broken by 20260601000003
-- ============================================================================
-- Root Cause: 20260601000003_comprehensive_lint_remediation.sql switched
-- several functions to SECURITY INVOKER to satisfy the linter. However,
-- functions that query auth.users or perform privileged inserts MUST remain
-- SECURITY DEFINER, as the calling role (anon/authenticated) does not have
-- direct access to auth schema or the underlying tables.
--
-- Affected functions:
--   1. get_user_bundle_v2()         → queries auth.users (requires DEFINER)
--   2. log_auth_attempt(text, bool) → inserts into auth_attempts (requires DEFINER)
--   3. log_auth_attempt(text, bool, text, text) → inserts into security_telemetry_events
-- ============================================================================

-- 1. Restore get_user_bundle_v2 to SECURITY DEFINER
--    This function performs a JOIN against auth.users which is inaccessible
--    to the authenticated role. Without SECURITY DEFINER it returns 403.
ALTER FUNCTION public.get_user_bundle_v2() SECURITY DEFINER;
ALTER FUNCTION public.get_user_bundle_v2() SET search_path = public, auth;

-- 2. Restore log_auth_attempt (2-param overload) to SECURITY DEFINER
--    Called by anon users during login flow. Requires INSERT on auth_attempts.
ALTER FUNCTION public.log_auth_attempt(text, boolean) SECURITY DEFINER;
ALTER FUNCTION public.log_auth_attempt(text, boolean) SET search_path = public;

-- 3. Restore log_auth_attempt (4-param overload) to SECURITY DEFINER
--    Inserts into security_telemetry_events. Same requirement.
ALTER FUNCTION public.log_auth_attempt(text, boolean, text, text) SECURITY DEFINER;
ALTER FUNCTION public.log_auth_attempt(text, boolean, text, text) SET search_path = public;

-- Re-grant execute to ensure anon role can call these during login
GRANT EXECUTE ON FUNCTION public.log_auth_attempt(text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_auth_attempt(text, boolean, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_bundle_v2() TO authenticated;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
