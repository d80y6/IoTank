-- ============================================================================
-- COMPREHENSIVE SECURITY HARDENING
-- Resolves: 
-- - function_search_path_mutable (0011)
-- - anon_security_definer_function_executable (0028)
-- - authenticated_security_definer_function_executable (0029)
-- ============================================================================

-- GROUP 1: TRIGGERS AND INTERNAL HELPERS
-- These functions should NOT be callable via PostgREST/RPC.
-- We set search_path and REVOKE EXECUTE from PUBLIC.
-- ============================================================================

-- Triggers
ALTER FUNCTION public.audit_trigger_handler() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.audit_trigger_handler() FROM PUBLIC;

ALTER FUNCTION public.handle_data_smoothing() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_data_smoothing() FROM PUBLIC;

ALTER FUNCTION public.handle_new_user() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

ALTER FUNCTION public.prevent_last_super_admin_removal() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.prevent_last_super_admin_removal() FROM PUBLIC;

ALTER FUNCTION public.prevent_unified_events_mutation() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.prevent_unified_events_mutation() FROM PUBLIC;

ALTER FUNCTION public.protect_profile_fields() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.protect_profile_fields() FROM PUBLIC;

ALTER FUNCTION public.protect_profile_sensitive_columns() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.protect_profile_sensitive_columns() FROM PUBLIC;

ALTER FUNCTION public.stamp_admin_log_user() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.stamp_admin_log_user() FROM PUBLIC;

ALTER FUNCTION public.stamp_audit_log_client() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.stamp_audit_log_client() FROM PUBLIC;

ALTER FUNCTION public.stamp_sender_name() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.stamp_sender_name() FROM PUBLIC;

ALTER FUNCTION public.sync_system_user_identity() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.sync_system_user_identity() FROM PUBLIC;

ALTER FUNCTION public.update_tank_state() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.update_tank_state() FROM PUBLIC;

ALTER FUNCTION public.validate_sensor_reading() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.validate_sensor_reading() FROM PUBLIC;

-- Internal/System Helpers
ALTER FUNCTION public.check_sla_breaches() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.check_sla_breaches() FROM PUBLIC;

ALTER FUNCTION public.check_tank_thresholds() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.check_tank_thresholds() FROM PUBLIC;

ALTER FUNCTION public.claim_pending_critical_alert_events(integer) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.claim_pending_critical_alert_events(integer) FROM PUBLIC;

ALTER FUNCTION public.complete_critical_alert_event(uuid, boolean, text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.complete_critical_alert_event(uuid, boolean, text) FROM PUBLIC;

ALTER FUNCTION public.purge_edge_rate_limits(integer) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.purge_edge_rate_limits(integer) FROM PUBLIC;

ALTER FUNCTION public.purge_security_telemetry_events(integer) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.purge_security_telemetry_events(integer) FROM PUBLIC;

ALTER FUNCTION public.safe_harden_table(text, text) SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.safe_harden_table(text, text) FROM PUBLIC;

ALTER FUNCTION public.safe_unschedule_job(text) SET search_path = public, cron;
REVOKE EXECUTE ON FUNCTION public.safe_unschedule_job(text) FROM PUBLIC;

ALTER FUNCTION public.update_tank_from_sensor() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.update_tank_from_sensor() FROM PUBLIC;


-- GROUP 2: APPLICATION RPCS (AUTHENTICATED ONLY)
-- These functions are called by the frontend but require a signed-in user.
-- We set search_path, REVOKE EXECUTE from PUBLIC, and GRANT to authenticated.
-- ============================================================================

-- Auth & Profile Helpers
ALTER FUNCTION public.current_auth_uid_text() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.current_auth_uid_text() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_auth_uid_text() TO authenticated;

ALTER FUNCTION public.get_auth_level() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.get_auth_level() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_auth_level() TO authenticated;

ALTER FUNCTION public.get_auth_user_id_by_email(text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) TO authenticated;

ALTER FUNCTION public.get_user_bundle_v2() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.get_user_bundle_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_bundle_v2() TO authenticated;

ALTER FUNCTION public.get_user_station_id() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.get_user_station_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_station_id() TO authenticated;

ALTER FUNCTION public.repair_my_identity() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.repair_my_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_my_identity() TO authenticated;

-- RBAC Helpers
ALTER FUNCTION public.has_client_access(integer) SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.has_client_access(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_client_access(integer) TO authenticated;

ALTER FUNCTION public.is_admin() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

ALTER FUNCTION public.is_system_admin(integer) SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.is_system_admin(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_admin(integer) TO authenticated;

ALTER FUNCTION public.is_system_admin(text) SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.is_system_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_admin(text) TO authenticated;

ALTER FUNCTION public.user_owns_client(text) SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.user_owns_client(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_owns_client(text) TO authenticated;

-- Analytics & Dashboard RPCs
ALTER FUNCTION public.get_business_kpis() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.get_business_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_business_kpis() TO authenticated;

ALTER FUNCTION public.get_station_dashboard_summary(uuid) SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.get_station_dashboard_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_station_dashboard_summary(uuid) TO authenticated;

ALTER FUNCTION public.get_station_id_from_auth() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.get_station_id_from_auth() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_station_id_from_auth() TO authenticated;

ALTER FUNCTION public.get_supplier_reliability_score(text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_supplier_reliability_score(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supplier_reliability_score(text) TO authenticated;

ALTER FUNCTION public.get_tank_analytics_30d(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.get_tank_analytics_30d(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tank_analytics_30d(uuid) TO authenticated;

ALTER FUNCTION public.refresh_tank_analytics() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.refresh_tank_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_tank_analytics() TO authenticated;

-- Operational RPCs
ALTER FUNCTION public.forensic_update_market_price(text, numeric, date, text, text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.forensic_update_market_price(text, numeric, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forensic_update_market_price(text, numeric, date, text, text) TO authenticated;

ALTER FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean) TO authenticated;

ALTER FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean, text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean, text) TO authenticated;

ALTER FUNCTION public.log_admin_action() SET search_path = public, auth;
REVOKE EXECUTE ON FUNCTION public.log_admin_action() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_admin_action() TO authenticated;

ALTER FUNCTION public.provision_registration_v2(uuid, uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.provision_registration_v2(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_registration_v2(uuid, uuid) TO authenticated;

ALTER FUNCTION public.resolve_all_station_events(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.resolve_all_station_events(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_all_station_events(uuid) TO authenticated;

ALTER FUNCTION public.resolve_unified_event(uuid) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.resolve_unified_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_unified_event(uuid) TO authenticated;

ALTER FUNCTION public.process_monthly_invoicing() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.process_monthly_invoicing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_monthly_invoicing() TO authenticated;


-- GROUP 3: PRE-AUTH RPCS (ANON + AUTHENTICATED)
-- These functions must be callable before a user signs in.
-- We set search_path, REVOKE EXECUTE from PUBLIC, and GRANT to anon, authenticated.
-- ============================================================================

ALTER FUNCTION public.check_auth_attempt(text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.check_auth_attempt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_auth_attempt(text) TO anon, authenticated;

ALTER FUNCTION public.consume_edge_rate_limit(text, text, integer, integer) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.consume_edge_rate_limit(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_edge_rate_limit(text, text, integer, integer) TO anon, authenticated;

ALTER FUNCTION public.log_auth_event(text, text, inet, text, text, text, jsonb) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.log_auth_event(text, text, inet, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_auth_event(text, text, inet, text, text, text, jsonb) TO anon, authenticated;

ALTER FUNCTION public.log_security_telemetry_event(text, text, text, text, uuid, text, text, integer, uuid, text, integer, text, jsonb) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.log_security_telemetry_event(text, text, text, text, uuid, text, text, integer, uuid, text, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_security_telemetry_event(text, text, text, text, uuid, text, text, integer, uuid, text, integer, text, jsonb) TO anon, authenticated;

-- RELOAD SCHEMA
NOTIFY pgrst, 'reload schema';
