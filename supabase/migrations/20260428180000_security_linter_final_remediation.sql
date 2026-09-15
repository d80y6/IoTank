-- ============================================================================
-- FINAL SECURITY LINTER REMEDIATION
-- Resolves: authenticated_security_definer_function_executable (0029)
-- ============================================================================

-- 1. CREATE INTERNAL SCHEMA
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS internal;

-- 2. MOVE TRIGGERS AND INTERNAL HELPERS TO INTERNAL SCHEMA (IDEMPOTENT)
-- ============================================================================
DO $$
DECLARE
    func_name TEXT;
    -- List of functions to move (without arguments if unique)
    simple_funcs TEXT[] := ARRAY[
        'audit_trigger_handler',
        'handle_data_smoothing',
        'handle_new_user',
        'prevent_last_super_admin_removal',
        'prevent_unified_events_mutation',
        'protect_profile_fields',
        'protect_profile_sensitive_columns',
        'stamp_admin_log_user',
        'stamp_audit_log_client',
        'stamp_sender_name',
        'sync_system_user_identity',
        'update_tank_state',
        'validate_sensor_reading',
        'check_sla_breaches',
        'check_tank_thresholds',
        'update_tank_from_sensor',
        'process_monthly_invoicing'
    ];
BEGIN
    -- Move simple functions
    FOREACH func_name IN ARRAY simple_funcs LOOP
        IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = func_name) THEN
            EXECUTE format('ALTER FUNCTION public.%I() SET SCHEMA internal', func_name);
        END IF;
    END LOOP;

    -- Move functions with specific signatures
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'claim_pending_critical_alert_events') THEN
        ALTER FUNCTION public.claim_pending_critical_alert_events(integer) SET SCHEMA internal;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'complete_critical_alert_event') THEN
        ALTER FUNCTION public.complete_critical_alert_event(uuid, boolean, text) SET SCHEMA internal;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'purge_edge_rate_limits') THEN
        ALTER FUNCTION public.purge_edge_rate_limits(integer) SET SCHEMA internal;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'purge_security_telemetry_events') THEN
        ALTER FUNCTION public.purge_security_telemetry_events(integer) SET SCHEMA internal;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'safe_harden_table') THEN
        ALTER FUNCTION public.safe_harden_table(text, text) SET SCHEMA internal;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'safe_unschedule_job') THEN
        ALTER FUNCTION public.safe_unschedule_job(text) SET SCHEMA internal;
    END IF;
END $$;

-- Revoke all on internal schema from public
REVOKE ALL ON SCHEMA internal FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA internal FROM PUBLIC;

-- 3. SWITCH ELIGIBLE RPCS TO SECURITY INVOKER
-- ============================================================================

ALTER FUNCTION public.get_business_kpis() SECURITY INVOKER;
ALTER FUNCTION public.get_station_dashboard_summary(uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_station_id_from_auth() SECURITY INVOKER;
ALTER FUNCTION public.get_user_station_id() SECURITY INVOKER;
ALTER FUNCTION public.get_supplier_reliability_score(text) SECURITY INVOKER;
ALTER FUNCTION public.get_tank_analytics_30d(uuid) SECURITY INVOKER;
ALTER FUNCTION public.refresh_tank_analytics() SECURITY INVOKER;
ALTER FUNCTION public.resolve_all_station_events(uuid) SECURITY INVOKER;
ALTER FUNCTION public.resolve_unified_event(uuid) SECURITY INVOKER;

-- New candidates for SECURITY INVOKER
ALTER FUNCTION public.current_auth_uid_text() SECURITY INVOKER;
ALTER FUNCTION public.get_auth_level() SECURITY INVOKER;
ALTER FUNCTION public.get_user_bundle_v2() SECURITY INVOKER;
ALTER FUNCTION public.repair_my_identity() SECURITY INVOKER;
ALTER FUNCTION public.provision_registration_v2(uuid, uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_auth_user_id_by_email(text) SECURITY INVOKER;
ALTER FUNCTION public.log_admin_action() SECURITY INVOKER;
ALTER FUNCTION public.forensic_update_market_price(text, numeric, date, text, text) SECURITY INVOKER;
ALTER FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean) SECURITY INVOKER;
ALTER FUNCTION public.forensic_update_market_price(text, numeric, timestamp with time zone, text, boolean, text) SECURITY INVOKER;

-- 4. HARDEN REMAINING SECURITY DEFINER RPCS
-- ============================================================================

-- Group 2: Authenticated Only (Must remain SECURITY DEFINER for RLS/Internal access)
DO $$
BEGIN
    -- has_client_access
    REVOKE EXECUTE ON FUNCTION public.has_client_access(integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.has_client_access(integer) TO authenticated;

    -- is_admin
    REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

    -- is_system_admin (overloads)
    REVOKE EXECUTE ON FUNCTION public.is_system_admin(integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_system_admin(integer) TO authenticated;
    REVOKE EXECUTE ON FUNCTION public.is_system_admin(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_system_admin(text) TO authenticated;

    -- user_owns_client
    REVOKE EXECUTE ON FUNCTION public.user_owns_client(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.user_owns_client(text) TO authenticated;
END $$;

-- Group 3: Pre-auth (Anon + Authenticated)
DO $$
BEGIN
    -- check_auth_attempt
    REVOKE EXECUTE ON FUNCTION public.check_auth_attempt(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.check_auth_attempt(text) TO anon, authenticated;

    -- consume_edge_rate_limit
    REVOKE EXECUTE ON FUNCTION public.consume_edge_rate_limit(text, text, integer, integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.consume_edge_rate_limit(text, text, integer, integer) TO anon, authenticated;

    -- log_auth_event
    REVOKE EXECUTE ON FUNCTION public.log_auth_event(text, text, inet, text, text, text, jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.log_auth_event(text, text, inet, text, text, text, jsonb) TO anon, authenticated;

    -- log_security_telemetry_event
    REVOKE EXECUTE ON FUNCTION public.log_security_telemetry_event(text, text, text, text, uuid, text, text, integer, uuid, text, integer, text, jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.log_security_telemetry_event(text, text, text, text, uuid, text, text, integer, uuid, text, integer, text, jsonb) TO anon, authenticated;
END $$;

-- 5. RELOAD SCHEMA
NOTIFY pgrst, 'reload schema';
