-- Bridge: get_admin_dashboard_stats is SECURITY INVOKER but reads from
-- internal. Force it to SECURITY DEFINER with internal on its search_path
-- so authenticated callers don't need direct internal access.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'get_admin_dashboard_stats'
    ) THEN
        ALTER FUNCTION public.get_admin_dashboard_stats() SECURITY DEFINER;
        ALTER FUNCTION public.get_admin_dashboard_stats() SET search_path = public, internal, auth;
    END IF;
END $$;
