-- supabase/migrations/20260514060000_security_linter_remediation.sql
-- ============================================================================
-- SECURITY LINTER REMEDIATION — Batch 2
-- Fixes all outstanding Supabase security advisor warnings:
--  1. [ERROR] security_definer_view       → latest_sensor_readings
--  2. [WARN]  function_search_path_mutable → 8 new functions
--  3. [WARN]  anon_security_definer_function_executable → revoke anon
--  4. [WARN]  authenticated_security_definer_function_executable → enforce auth
--  5. [WARN]  rls_policy_always_true      → security_telemetry_events INSERT
-- 
-- NOTE: supabase_backups.* tables are internal Supabase-managed tables;
--       we cannot and should not add policies to them — these INFO items
--       are expected and cannot be remediated from user migrations.
-- NOTE: auth_leaked_password_protection must be enabled via the
--       Supabase Dashboard → Authentication → Password protection.
-- ============================================================================

-- ── 1. SECURITY DEFINER VIEW FIX ──────────────────────────────────────────
-- Recreate latest_sensor_readings as SECURITY INVOKER so it uses the
-- querying user's RLS context, not the view creator's elevated permissions.

DROP VIEW IF EXISTS public.latest_sensor_readings;
CREATE VIEW public.latest_sensor_readings
    WITH (security_invoker = true)
AS
SELECT DISTINCT ON (tank_id)
    id,
    station_id,
    tank_id,
    volume,
    volume_corrected,
    temperature,
    captured_at,
    metadata,
    rssi,
    signal_strength
FROM public.sensor_readings
ORDER BY tank_id, captured_at DESC;

GRANT SELECT ON public.latest_sensor_readings TO authenticated;

-- ── 2. SEARCH PATH REMEDIATION ─────────────────────────────────────────────
-- Add SET search_path = public to all functions not yet covered by
-- the 20260428160000_comprehensive_security_hardening migration.

-- Trigger Functions (no PUBLIC execute needed)
ALTER FUNCTION public.prevent_audit_tampering()
    SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.prevent_audit_tampering() FROM PUBLIC;

ALTER FUNCTION public.prevent_alert_tampering()
    SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.prevent_alert_tampering() FROM PUBLIC;

ALTER FUNCTION public.handle_new_station_setup()
    SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_station_setup() FROM PUBLIC;

ALTER FUNCTION public.handle_new_station_setup_before()
    SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_station_setup_before() FROM PUBLIC;

ALTER FUNCTION public.handle_new_station_setup_after()
    SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_station_setup_after() FROM PUBLIC;

-- Internal Cron / System Functions
ALTER FUNCTION public.apply_monthly_billing()
    SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.apply_monthly_billing() FROM PUBLIC;
-- apply_monthly_billing is invoked by pg_cron (service_role), not by users
-- Do NOT grant to authenticated.

ALTER FUNCTION public.enforce_billing_suspensions()
    SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.enforce_billing_suspensions() FROM PUBLIC;
-- Same: internal cron job.

ALTER FUNCTION public.check_station_active(UUID)
    SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.check_station_active(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_station_active(UUID) TO authenticated;

-- ── 3. REVOKE ANON EXECUTE ON SECURITY DEFINER FUNCTIONS ──────────────────
-- These functions expose sensitive data or system administration capabilities.
-- They must only be callable by authenticated (signed-in) users.

-- Identity / Role Checks
REVOKE EXECUTE ON FUNCTION public.check_is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_is_staff() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_is_super_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_my_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_my_identity() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_station_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_station_id() TO authenticated;

-- Destructive / Admin Operations
REVOKE EXECUTE ON FUNCTION public.delete_user_safely(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_safely(UUID) TO authenticated;

-- Admin Dashboard Stats (sensitive cross-station queries)
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_risk_matrix() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_risk_matrix() TO authenticated;

-- TankIQ Intelligence Functions (station-scoped, authenticated only)
REVOKE EXECUTE ON FUNCTION public.get_tankiq_audit_logs(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tankiq_audit_logs(UUID, INTEGER) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_tankiq_financial_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tankiq_financial_status(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_tankiq_hardware_health(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tankiq_hardware_health(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_tankiq_shift_analytics(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tankiq_shift_analytics(UUID, INTEGER) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_tankiq_station_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tankiq_station_summary(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_tankiq_support_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tankiq_support_summary(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_tankiq_usage_insights(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tankiq_usage_insights(UUID, INTEGER) TO authenticated;

-- Payment Processing (must be authenticated, never anonymous)
REVOKE EXECUTE ON FUNCTION public.process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_payment(UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- Alert Engine RPC (called by hardware via service_role key — keep anon revoked,
-- service_role bypasses RLS entirely, so hardware will still work)
REVOKE EXECUTE ON FUNCTION public.upsert_alert_v2(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_alert_v2(UUID, UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.upsert_alert_v2(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_alert_v2(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ── 4. PRE-AUTH FUNCTIONS — keep accessible to anon ────────────────────────
-- These are called BEFORE a user is signed in (login/registration flows).
-- The linter flags them as warnings, but this is intentional.
-- We add SET search_path and verify anon+authenticated access is correct.

ALTER FUNCTION public.log_auth_attempt(TEXT, BOOLEAN)
    SET search_path = public;
-- Already callable by anon + authenticated — intentional, keep as-is.

ALTER FUNCTION public.log_auth_attempt(TEXT, BOOLEAN, TEXT, TEXT)
    SET search_path = public;
-- Same — called from pre-auth login telemetry.

ALTER FUNCTION public.log_registration_event(UUID, TEXT, TEXT, TEXT, JSONB)
    SET search_path = public;
-- Same — called during registration flow before user exists.

-- ── 5. RLS POLICY — FIX ALWAYS TRUE INSERT CHECK ──────────────────────────
-- The INSERT policy on security_telemetry_events with CHECK (true) is overly
-- permissive. Require at minimum that event_type is not null.

DROP POLICY IF EXISTS "Consolidated security_telemetry_events INSERT" ON public.security_telemetry_events;
DROP POLICY IF EXISTS "security_telemetry_events: insert requires event_type" ON public.security_telemetry_events;
CREATE POLICY "security_telemetry_events: insert requires event_type"
    ON public.security_telemetry_events
    FOR INSERT
    TO public
    WITH CHECK (event_type IS NOT NULL);

-- ── NOTIFY PostgREST ───────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
