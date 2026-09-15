-- supabase/migrations/20260506145600_security_linter_remediation_final.sql
-- ============================================================================
-- RESOLVING SECURITY LINTER WARNINGS
-- ============================================================================

-- 1. Fix: rls_disabled_in_public for unified_events partitions
-- Partitions do not automatically inherit RLS from their parent in Postgres.
ALTER TABLE IF EXISTS public.unified_events_2026_03 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.unified_events_2026_04 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.unified_events_2026_05 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.unified_events_2026_06 ENABLE ROW LEVEL SECURITY;

-- 2. Fix: function_search_path_mutable
-- Any SECURITY DEFINER function or function handling sensitive data should have its search_path explicitly set
-- to prevent search path injection attacks.

ALTER FUNCTION public.log_auth_attempt(text, boolean) SET search_path = public;
ALTER FUNCTION internal.manage_event_partitions() SET search_path = public, internal;
ALTER FUNCTION internal.redact_pii(jsonb) SET search_path = public, internal;

-- We also need to update create_event_partition to auto-enable RLS on future partitions 
-- and set its search_path.
CREATE OR REPLACE FUNCTION internal.create_event_partition(p_year_month TEXT)
RETURNS VOID AS $$
DECLARE
    v_table_name TEXT;
    v_start_date TEXT;
    v_end_date TEXT;
BEGIN
    v_table_name := 'unified_events_' || p_year_month;
    v_start_date := replace(p_year_month, '_', '-') || '-01';
    v_end_date := (v_start_date)::DATE + INTERVAL '1 month';

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.unified_events 
         FOR VALUES FROM (%L) TO (%L)',
        v_table_name, v_start_date, v_end_date
    );
    
    -- Auto-enable RLS on the newly created partition to prevent future linter errors
    EXECUTE format(
        'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
        v_table_name
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, internal;

-- Ensure all other SECURITY DEFINER functions flagged by the linter have a secure search_path.
-- (Even though the linter warns about them being executable by anon/authenticated, they are intentionally
-- exposed. Securing their search_path hardens them against injection).
ALTER FUNCTION public.check_auth_attempt(text) SET search_path = public;
ALTER FUNCTION public.consume_edge_rate_limit(text, text, integer, integer) SET search_path = public;
ALTER FUNCTION public.log_auth_event(text, text, inet, text, text, text, jsonb) SET search_path = public;
ALTER FUNCTION public.log_security_telemetry_event(text, text, text, text, uuid, text, text, integer, uuid, text, integer, text, jsonb) SET search_path = public;
ALTER FUNCTION public.has_client_access(integer) SET search_path = public;
ALTER FUNCTION public.is_admin() SET search_path = public;
ALTER FUNCTION public.is_system_admin(integer) SET search_path = public;
ALTER FUNCTION public.is_system_admin(text) SET search_path = public;
ALTER FUNCTION public.user_owns_client(text) SET search_path = public;

-- 3. Fix: public_bucket_allows_listing
-- The linter flags the "Public read for uploads" policy on storage.objects because it allows listing the bucket contents.
-- Public buckets automatically serve file URLs without this policy, so a broad SELECT is an unnecessary risk.
-- If the application only requires reading known files via their URL, this policy should be dropped or restricted.
DROP POLICY IF EXISTS "Public read for uploads" ON storage.objects;

-- Note on remaining WARNINGS (anon_security_definer_function_executable / authenticated_security_definer_function_executable):
-- The linter warns about SECURITY DEFINER functions exposed to anon/authenticated roles.
-- These functions (check_auth_attempt, log_auth_event, is_system_admin, etc.) are intentionally designed 
-- this way so that unprivileged users can safely insert telemetry logs or verify roles without having direct 
-- table access. Their search paths have been secured above.

-- 4. Convert safe data-fetching functions to SECURITY INVOKER to satisfy the linter
-- These functions rely on RLS policies anyway and do not need to bypass RLS.
ALTER FUNCTION public.add_debt_to_client(uuid, numeric, text) SECURITY INVOKER;
ALTER FUNCTION public.detect_theft_anomaly(uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_admin_dashboard_stats() SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_consumption_stats(uuid, integer) SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_delivery_logs(uuid, integer) SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_market_context() SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_station_summary(uuid) SECURITY INVOKER;

-- 5. Revoke anon access from functions that should ONLY be called by authenticated users
-- The linter warns if 'anon' can call authenticated-only functions.
REVOKE EXECUTE ON FUNCTION public.add_debt_to_client(uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.detect_theft_anomaly(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_consumption_stats(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_delivery_logs(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_market_context() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_station_summary(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_client_access(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_system_admin(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_system_admin(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_owns_client(text) FROM anon;