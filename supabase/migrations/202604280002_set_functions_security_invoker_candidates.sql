-- Migration: Candidate statements to convert functions to SECURITY INVOKER
-- Date: 2026-04-28
-- Purpose: Provide ALTER FUNCTION statements for functions that may be safe
-- to run as SECURITY INVOKER. THESE LINES ARE COMMENTED OUT — review first.

BEGIN;

-- Review each function body and dependencies before enabling the corresponding
-- ALTER FUNCTION statement. Converting a function that requires elevated
-- privileges to SECURITY INVOKER can break behavior or require reworking grants.

-- To apply a specific change: remove the leading `-- ` from the ALTER line
-- and run the resulting statement (or include it in a migration after review).

-- Example:
-- ALTER FUNCTION public.some_fn(integer) SECURITY INVOKER;

-- Candidate ALTER statements (commented):
-- core API / auth helpers
-- ALTER FUNCTION public.audit_trigger_handler() SECURITY INVOKER;
-- ALTER FUNCTION public.check_auth_attempt(text) SECURITY INVOKER;
-- ALTER FUNCTION public.check_sla_breaches() SECURITY INVOKER;
-- ALTER FUNCTION public.check_tank_thresholds() SECURITY INVOKER;
-- ALTER FUNCTION public.claim_pending_critical_alert_events(integer) SECURITY INVOKER;
-- ALTER FUNCTION public.complete_critical_alert_event(uuid, boolean, text) SECURITY INVOKER;
-- ALTER FUNCTION public.consume_edge_rate_limit(text, text, integer, integer) SECURITY INVOKER;
-- ALTER FUNCTION public.current_auth_uid_text() SECURITY INVOKER;

-- forensic_update_market_price (multiple overloads)
-- ALTER FUNCTION public.forensic_update_market_price(text, numeric, date, text, text) SECURITY INVOKER;
-- ALTER FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean) SECURITY INVOKER;
-- ALTER FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean, text) SECURITY INVOKER;

-- auth / user helpers
-- ALTER FUNCTION public.get_auth_level() SECURITY INVOKER;
-- ALTER FUNCTION public.get_auth_user_id_by_email(text) SECURITY INVOKER;
-- ALTER FUNCTION public.get_business_kpis() SECURITY INVOKER;
-- ALTER FUNCTION public.get_station_dashboard_summary(uuid) SECURITY INVOKER;
-- ALTER FUNCTION public.get_station_id_from_auth() SECURITY INVOKER;
-- ALTER FUNCTION public.get_supplier_reliability_score(text) SECURITY INVOKER;
-- ALTER FUNCTION public.get_tank_analytics_30d(uuid) SECURITY INVOKER;
-- ALTER FUNCTION public.get_user_bundle_v2() SECURITY INVOKER;
-- ALTER FUNCTION public.get_user_station_id() SECURITY INVOKER;

-- processing / background tasks
-- ALTER FUNCTION public.handle_data_smoothing() SECURITY INVOKER;
-- ALTER FUNCTION public.handle_new_user() SECURITY INVOKER;
-- ALTER FUNCTION public.has_client_access(integer) SECURITY INVOKER;
-- ALTER FUNCTION public.is_admin() SECURITY INVOKER;
-- ALTER FUNCTION public.is_system_admin(integer) SECURITY INVOKER;
-- ALTER FUNCTION public.is_system_admin(text) SECURITY INVOKER;

-- logging / telemetry
-- ALTER FUNCTION public.log_admin_action() SECURITY INVOKER;
-- ALTER FUNCTION public.log_auth_event(text, text, inet, text, text, text, jsonb) SECURITY INVOKER;
-- ALTER FUNCTION public.log_security_telemetry_event(text, text, text, text, uuid, text, text, integer, uuid, text, integer, text, jsonb) SECURITY INVOKER;

-- protection / safety
-- ALTER FUNCTION public.prevent_last_super_admin_removal() SECURITY INVOKER;
-- ALTER FUNCTION public.prevent_unified_events_mutation() SECURITY INVOKER;
-- ALTER FUNCTION public.process_monthly_invoicing() SECURITY INVOKER;
-- ALTER FUNCTION public.protect_profile_fields() SECURITY INVOKER;
-- ALTER FUNCTION public.protect_profile_sensitive_columns() SECURITY INVOKER;

-- provisioning / management
-- ALTER FUNCTION public.provision_registration_v2(uuid, uuid) SECURITY INVOKER;
-- ALTER FUNCTION public.purge_edge_rate_limits(integer) SECURITY INVOKER;
-- ALTER FUNCTION public.purge_security_telemetry_events(integer) SECURITY INVOKER;
-- ALTER FUNCTION public.refresh_tank_analytics() SECURITY INVOKER;
-- ALTER FUNCTION public.repair_my_identity() SECURITY INVOKER;

-- event resolution / scheduling
-- ALTER FUNCTION public.resolve_all_station_events(uuid) SECURITY INVOKER;
-- ALTER FUNCTION public.resolve_unified_event(uuid) SECURITY INVOKER;
-- ALTER FUNCTION public.safe_harden_table(text, text) SECURITY INVOKER;
-- ALTER FUNCTION public.safe_unschedule_job(text) SECURITY INVOKER;

-- stamping / audit helpers
-- ALTER FUNCTION public.stamp_admin_log_user() SECURITY INVOKER;
-- ALTER FUNCTION public.stamp_audit_log_client() SECURITY INVOKER;
-- ALTER FUNCTION public.stamp_sender_name() SECURITY INVOKER;

-- sync / updates
-- ALTER FUNCTION public.sync_system_user_identity() SECURITY INVOKER;
-- ALTER FUNCTION public.update_tank_from_sensor() SECURITY INVOKER;
-- ALTER FUNCTION public.update_tank_state() SECURITY INVOKER;

-- ownership / validation
-- ALTER FUNCTION public.user_owns_client(text) SECURITY INVOKER;
-- ALTER FUNCTION public.validate_sensor_reading() SECURITY INVOKER;

COMMIT;

-- Next steps:
-- 1) Review each function's body (in supabase/functions, migrations, or DB) to
--    verify whether it performs privileged actions that require SECURITY DEFINER.
-- 2) For safe functions: uncomment the corresponding ALTER and run it.
-- 3) For functions that must remain SECURITY DEFINER, consider moving them to
--    an `internal` schema and only exposing approved wrappers to `anon`/`authenticated`.
