-- fix_helper_functions.sql
-- ============================================================================
-- HOTFIX: Restore SECURITY DEFINER to authorization helper functions
--
-- Functions that query the 'system_users' table (like check_is_staff) MUST be 
-- SECURITY DEFINER. If they are SECURITY INVOKER, queries against 'system_users' 
-- trigger its RLS policy. Since the RLS policy on system_users itself needs 
-- to verify if the user is a staff member, it creates a self-referential 
-- infinite RLS recursion.
-- ============================================================================

BEGIN;

-- Restore SECURITY DEFINER and secure the search path to appease the linter
ALTER FUNCTION public.check_is_staff() SECURITY DEFINER SET search_path = public, auth;
ALTER FUNCTION public.check_is_super_admin() SECURITY DEFINER SET search_path = public, auth;
ALTER FUNCTION public.is_system_admin(minimum_level integer) SECURITY DEFINER SET search_path = public, auth;
ALTER FUNCTION public.is_system_admin(minimum_role text) SECURITY DEFINER SET search_path = public, auth;

-- Revoke from PUBLIC and anon to be perfectly secure and satisfy linters
REVOKE EXECUTE ON FUNCTION public.check_is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_staff() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_super_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_system_admin(minimum_level integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_system_admin(minimum_level integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_system_admin(minimum_role text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_system_admin(minimum_role text) TO authenticated;

-- Ensure get_auth_level is also protected if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_auth_level') THEN
        ALTER FUNCTION public.get_auth_level() SECURITY DEFINER SET search_path = public, auth;
        REVOKE EXECUTE ON FUNCTION public.get_auth_level() FROM PUBLIC, anon;
        GRANT EXECUTE ON FUNCTION public.get_auth_level() TO authenticated;
    END IF;
END
$$;

-- Reload postgrest
NOTIFY pgrst, 'reload schema';

COMMIT;
