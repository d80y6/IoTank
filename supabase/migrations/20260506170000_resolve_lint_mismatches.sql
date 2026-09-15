-- supabase/migrations/20260506170000_resolve_lint_mismatches.sql
-- ============================================================
-- RESOLVING REMAINING SECURITY LINTER ISSUES
-- ============================================================

-- ============================================================
-- SECTION A: Revoke execute from telemetry/logging functions
-- These are ONLY called from Edge Functions via service_role.
-- Revoking from anon + authenticated clears all
-- anon_security_definer + authenticated_security_definer warnings
-- for these functions. service_role is unaffected by REVOKE.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.check_auth_attempt(p_email text)
    FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.consume_edge_rate_limit(
    p_scope_key text, p_endpoint text, p_window_seconds integer, p_max_requests integer)
    FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.log_auth_attempt(p_email text, p_is_success boolean)
    FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.log_auth_attempt(
    p_email text, p_success boolean, p_ip text, p_user_agent text)
    FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.log_auth_event(
    p_event_type text, p_user_email text, p_ip_address inet,
    p_user_agent text, p_status text, p_error_message text, p_detail_json jsonb)
    FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.log_security_telemetry_event(
    p_event_type text, p_severity text, p_source text, p_endpoint text,
    p_actor_uid uuid, p_actor_email text, p_actor_role text,
    p_actor_auth_level integer, p_station_id uuid, p_scope_key text,
    p_status_code integer, p_reason text, p_details jsonb)
    FROM anon, authenticated;

-- ============================================================
-- SECTION B: Revoke execute from RLS helper functions for anon.
-- These helpers MUST remain callable by `authenticated` because
-- they are evaluated inside RLS USING clauses for authenticated
-- queries. Revoking from authenticated would break RLS evaluation.
-- Revoking from anon is safe — anon users should never call them.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.has_client_access(required_level integer)
    FROM anon;

REVOKE EXECUTE ON FUNCTION public.is_admin()
    FROM anon;

REVOKE EXECUTE ON FUNCTION public.is_system_admin(minimum_level integer)
    FROM anon;

REVOKE EXECUTE ON FUNCTION public.is_system_admin(minimum_role text)
    FROM anon;

REVOKE EXECUTE ON FUNCTION public.user_owns_client(client_firebase_uid text)
    FROM anon;

-- ============================================================
-- SECTION C: Add RLS policies to unified_events partitions.
-- The partitions have RLS enabled but no policies defined.
-- We mirror the parent table's access pattern.
-- ============================================================

-- 2026-03 partition
DROP POLICY IF EXISTS "Station members can view unified events" ON public.unified_events_2026_03;
CREATE POLICY "Station members can view unified events" ON public.unified_events_2026_03
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE station_id = unified_events_2026_03.station_id
              AND auth_user_id = (SELECT auth.uid())
        )
        OR (SELECT public.get_auth_level()) <= 4
    );

-- 2026-04 partition
DROP POLICY IF EXISTS "Station members can view unified events" ON public.unified_events_2026_04;
CREATE POLICY "Station members can view unified events" ON public.unified_events_2026_04
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE station_id = unified_events_2026_04.station_id
              AND auth_user_id = (SELECT auth.uid())
        )
        OR (SELECT public.get_auth_level()) <= 4
    );

-- 2026-05 partition
DROP POLICY IF EXISTS "Station members can view unified events" ON public.unified_events_2026_05;
CREATE POLICY "Station members can view unified events" ON public.unified_events_2026_05
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE station_id = unified_events_2026_05.station_id
              AND auth_user_id = (SELECT auth.uid())
        )
        OR (SELECT public.get_auth_level()) <= 4
    );

-- 2026-06 partition
DROP POLICY IF EXISTS "Station members can view unified events" ON public.unified_events_2026_06;
CREATE POLICY "Station members can view unified events" ON public.unified_events_2026_06
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE station_id = unified_events_2026_06.station_id
              AND auth_user_id = (SELECT auth.uid())
        )
        OR (SELECT public.get_auth_level()) <= 4
    );

-- ============================================================
-- SECTION D: Fix remaining auth_rls_initplan warnings.
-- Three policies use current_setting() without (SELECT ...) wrapper.
-- Our previous DO block only handled auth.uid() / auth.jwt().
-- We manually recreate these three policies with the fix.
-- ============================================================

-- fuel_stations: "Service role full access to billing"
DROP POLICY IF EXISTS "Service role full access to billing" ON public.fuel_stations;
CREATE POLICY "Service role full access to billing" ON public.fuel_stations
    FOR ALL TO authenticated
    USING (
        (SELECT current_setting('request.jwt.claims', true))::jsonb->>'role' = 'service_role'
    )
    WITH CHECK (
        (SELECT current_setting('request.jwt.claims', true))::jsonb->>'role' = 'service_role'
    );

-- transactions: "Service role full access to transactions"
DROP POLICY IF EXISTS "Service role full access to transactions" ON public.transactions;
CREATE POLICY "Service role full access to transactions" ON public.transactions
    FOR ALL TO authenticated
    USING (
        (SELECT current_setting('request.jwt.claims', true))::jsonb->>'role' = 'service_role'
    )
    WITH CHECK (
        (SELECT current_setting('request.jwt.claims', true))::jsonb->>'role' = 'service_role'
    );

-- sensor_readings: "Hardware devices can insert readings"
DROP POLICY IF EXISTS "Hardware devices can insert readings" ON public.sensor_readings;
CREATE POLICY "Hardware devices can insert readings" ON public.sensor_readings
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT current_setting('request.jwt.claims', true))::jsonb->>'role' = 'service_role'
        OR EXISTS (
            SELECT 1 FROM public.devices d
            WHERE d.station_id = sensor_readings.station_id
        )
    );
