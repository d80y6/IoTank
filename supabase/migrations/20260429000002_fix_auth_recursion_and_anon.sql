-- supabase/migrations/20260429000002_fix_auth_recursion_and_anon.sql
-- ============================================================================
-- 1. Restore get_user_bundle_v2 to SECURITY DEFINER
-- Changing this to SECURITY INVOKER caused infinite RLS recursion because
-- the RLS policies themselves depend on this function, and running it as
-- INVOKER triggers those policies while it's executing.
-- ============================================================================
ALTER FUNCTION public.get_user_bundle_v2() SECURITY DEFINER SET search_path = public, auth;

-- ============================================================================
-- 2. Restore log_auth_attempt (Accidentally pruned in dead code cleanup)
-- This RPC is explicitly designed to be called BEFORE a user has a session.
-- Revoking anon execute broke the login auditing flow.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_auth_attempt(p_email TEXT, p_is_success BOOLEAN)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.auth_attempts (email, is_success, ip_address)
    VALUES (LOWER(TRIM(p_email)), p_is_success, net.ip_address_to_inet(current_setting('request.headers', true)::json->>'x-real-ip'));
EXCEPTION WHEN OTHERS THEN
    -- Fallback if ip resolution fails
    INSERT INTO public.auth_attempts (email, is_success)
    VALUES (LOWER(TRIM(p_email)), p_is_success);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.log_auth_attempt(TEXT, BOOLEAN) TO anon, authenticated;

-- Reload schema to apply permissions and function definitions
NOTIFY pgrst, 'reload schema';
