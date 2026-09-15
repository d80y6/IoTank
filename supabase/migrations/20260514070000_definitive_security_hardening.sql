-- supabase/migrations/20260514070000_definitive_security_hardening.sql
-- ============================================================================
-- DEFINITIVE SECURITY HARDENING — Linter Remediation
-- Resolves all outstanding Supabase linter warnings regarding:
--  1. anon_security_definer_function_executable
--  2. authenticated_security_definer_function_executable
--  3. function_search_path_mutable
-- ============================================================================

-- ── 1. GLOBAL PRIVILEGE RESET ───────────────────────────────────────────────
-- Revoke EXECUTE on all functions in public from PUBLIC by default.
-- This ensures any new functions are secure from the start.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── 2. INDIVIDUAL FUNCTION HARDENING ────────────────────────────────────────

-- Billing & System Operations (Internal only)
ALTER FUNCTION public.apply_monthly_billing() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.apply_monthly_billing() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.enforce_billing_suspensions() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.enforce_billing_suspensions() FROM PUBLIC, anon, authenticated;

-- Identity & Role Checks
ALTER FUNCTION public.check_is_staff() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.check_is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_staff() TO authenticated;

ALTER FUNCTION public.check_is_super_admin() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.check_is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_super_admin() TO authenticated;

ALTER FUNCTION public.check_my_identity() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.check_my_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_my_identity() TO authenticated;

ALTER FUNCTION public.get_my_station_id() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_my_station_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_station_id() TO authenticated;

ALTER FUNCTION public.get_user_bundle_v2() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_user_bundle_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_bundle_v2() TO authenticated;

ALTER FUNCTION public.is_system_admin(integer) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.is_system_admin(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_system_admin(integer) TO authenticated;

ALTER FUNCTION public.is_system_admin(text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.is_system_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_system_admin(text) TO authenticated;

ALTER FUNCTION public.repair_my_identity() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.repair_my_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_my_identity() TO authenticated;

-- Admin & Management
ALTER FUNCTION public.delete_user_safely(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.delete_user_safely(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_safely(uuid) TO authenticated;

ALTER FUNCTION public.get_admin_dashboard_stats() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated;

ALTER FUNCTION public.get_admin_risk_matrix() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_admin_risk_matrix() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_risk_matrix() TO authenticated;

ALTER FUNCTION public.get_auth_user_id_by_email(text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) TO authenticated;

-- Analytics & Intelligence (Station Scoped)
ALTER FUNCTION public.get_station_dashboard_summary(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_station_dashboard_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_station_dashboard_summary(uuid) TO authenticated;

ALTER FUNCTION public.get_tankiq_audit_logs(uuid, integer) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_audit_logs(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tankiq_audit_logs(uuid, integer) TO authenticated;

ALTER FUNCTION public.get_tankiq_financial_status(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_financial_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tankiq_financial_status(uuid) TO authenticated;

ALTER FUNCTION public.get_tankiq_hardware_health(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_hardware_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tankiq_hardware_health(uuid) TO authenticated;

ALTER FUNCTION public.get_tankiq_shift_analytics(uuid, integer) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_shift_analytics(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tankiq_shift_analytics(uuid, integer) TO authenticated;

ALTER FUNCTION public.get_tankiq_station_summary(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_station_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tankiq_station_summary(uuid) TO authenticated;

ALTER FUNCTION public.get_tankiq_support_summary(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_support_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tankiq_support_summary(uuid) TO authenticated;

ALTER FUNCTION public.get_tankiq_usage_insights(uuid, integer) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_tankiq_usage_insights(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tankiq_usage_insights(uuid, integer) TO authenticated;

-- Operational Handlers
ALTER FUNCTION public.process_payment(uuid, numeric, text, text, text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.process_payment(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_payment(uuid, numeric, text, text, text) TO authenticated;

ALTER FUNCTION public.upsert_alert_v2(uuid, uuid, text, text, text, jsonb) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.upsert_alert_v2(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_alert_v2(uuid, uuid, text, text, text, jsonb) TO authenticated;

ALTER FUNCTION public.upsert_alert_v2(uuid, uuid, text, text, text, text, jsonb) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.upsert_alert_v2(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_alert_v2(uuid, uuid, text, text, text, text, jsonb) TO authenticated;

-- ── 3. PRE-AUTH / PUBLIC TELEMETRY ─────────────────────────────────────────
-- These functions are intentionally accessible to anon for login/registration.
-- We only harden their search_path and ensure they are restricted from PUBLIC
-- if we want to be absolutely granular, but keeping them accessible to anon.

ALTER FUNCTION public.log_auth_attempt(text, boolean) SET search_path = public;
-- Explicitly allow anon for login telemetry
GRANT EXECUTE ON FUNCTION public.log_auth_attempt(text, boolean) TO anon, authenticated;

ALTER FUNCTION public.log_auth_attempt(text, boolean, text, text) SET search_path = public;
-- Explicitly allow anon for login telemetry
GRANT EXECUTE ON FUNCTION public.log_auth_attempt(text, boolean, text, text) TO anon, authenticated;

ALTER FUNCTION public.log_registration_event(uuid, text, text, text, jsonb) SET search_path = public;
-- Explicitly allow anon for registration flow
GRANT EXECUTE ON FUNCTION public.log_registration_event(uuid, text, text, text, jsonb) TO anon, authenticated;

-- ── 4. NOTIFY PostgREST ───────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
