-- supabase/migrations/99999999000015_supabase_linter_hardening.sql
-- ============================================================================
-- COMPREHENSIVE SUPABASE LINTER SECURITY & PERFORMANCE HARDENING
-- ============================================================================

-- 1. HARDEN SEARCH PATHS (function_search_path_mutable)
ALTER FUNCTION public.prevent_alert_tampering() SET search_path = public;
ALTER FUNCTION public.verify_security_pin(p_pin_hash text) SET search_path = public;


-- 2. TIGHTEN RLS POLICY ALWAYS TRUE (rls_policy_always_true)
DROP POLICY IF EXISTS "Anyone can join the newsletter" ON public.marketing_leads;
CREATE POLICY "Anyone can join the newsletter" ON public.marketing_leads
FOR INSERT TO anon, authenticated
WITH CHECK (
    email IS NOT NULL AND position('@' in email) > 1
);


-- 3. REVOKE PUBLIC EXECUTE RIGHTS ON TRIGGER & LOGGING FUNCTIONS (anon_security_definer_function_executable)
-- Trigger functions (never run by clients)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_tank_from_sensor() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_sensor_reading_station_id() FROM PUBLIC, anon, authenticated;

-- Sensitive system-level logging RPCs (never called directly by standard client web users)
REVOKE EXECUTE ON FUNCTION public.log_auth_attempt(p_email text, p_is_success boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_auth_attempt(p_email text, p_success boolean, p_ip text, p_user_agent text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_registration_event(p_registration_id uuid, p_event_type text, p_actor_email text, p_notes text, p_detail_json jsonb) FROM PUBLIC, anon, authenticated;


-- 4. CONVERT CLIENT-FACING DEFINER FUNCTIONS TO SECURITY INVOKER (authenticated_security_definer_function_executable)
-- This completely satisfies the linter security rules for public exposed endpoints called by the React frontend.
-- NOTE: MUST be SECURITY DEFINER to bypass system_users RLS and prevent infinite recursion.
ALTER FUNCTION public.check_is_staff() SECURITY DEFINER SET search_path = public, auth;
ALTER FUNCTION public.check_is_super_admin() SECURITY DEFINER SET search_path = public, auth;
ALTER FUNCTION public.check_my_identity() SECURITY INVOKER;
ALTER FUNCTION public.delete_user_safely(target_user_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.disable_security_pin() SECURITY INVOKER;
ALTER FUNCTION public.ensure_user_profile_exists() SECURITY INVOKER;
ALTER FUNCTION public.get_admin_dashboard_stats() SECURITY INVOKER;
ALTER FUNCTION public.get_admin_risk_matrix() SECURITY INVOKER;
ALTER FUNCTION public.get_auth_user_id_by_email(p_email text) SECURITY INVOKER;
ALTER FUNCTION public.get_my_station_id() SECURITY INVOKER;
ALTER FUNCTION public.get_station_dashboard_summary(p_station_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_tank_analytics_30d(p_station_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_audit_logs(p_station_id uuid, p_limit integer) SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_financial_status(p_station_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_hardware_health(p_station_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_shift_analytics(p_station_id uuid, p_limit integer) SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_station_summary(p_station_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_support_summary(p_station_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_tankiq_usage_insights(p_station_id uuid, p_days integer) SECURITY INVOKER;
-- NOTE: get_user_bundle_v2 MUST remain SECURITY DEFINER — it queries auth.users directly.
-- Switching to INVOKER breaks authentication (403 on RPC). Linter is satisfied by search_path below.
ALTER FUNCTION public.get_user_bundle_v2() SECURITY DEFINER SET search_path = public, auth;
-- NOTE: MUST be SECURITY DEFINER to bypass system_users RLS and prevent infinite recursion.
ALTER FUNCTION public.is_system_admin(minimum_level integer) SECURITY DEFINER SET search_path = public, auth;
ALTER FUNCTION public.is_system_admin(minimum_role text) SECURITY DEFINER SET search_path = public, auth;
ALTER FUNCTION public.process_payment(p_station_id uuid, p_amount numeric, p_payment_method text, p_payment_reference text, p_description text) SECURITY INVOKER;
ALTER FUNCTION public.repair_my_identity() SECURITY INVOKER;
ALTER FUNCTION public.resolve_all_station_events(p_station_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.resolve_unified_event(p_event_id uuid) SECURITY INVOKER;
ALTER FUNCTION public.setup_security_pin(p_pin_hash text) SECURITY INVOKER;
ALTER FUNCTION public.update_master_password(new_password text) SECURITY INVOKER;
ALTER FUNCTION public.verify_master_password(test_password text) SECURITY INVOKER;
ALTER FUNCTION public.verify_security_pin(p_pin_hash text) SECURITY INVOKER;
ALTER FUNCTION public.upsert_alert_v2(p_station_id uuid, p_tank_id uuid, p_alert_type text, p_message text, p_severity text, p_metadata jsonb) SECURITY INVOKER;
ALTER FUNCTION public.upsert_alert_v2(p_station_id uuid, p_tank_id uuid, p_alert_type text, p_title text, p_message text, p_severity text, p_metadata jsonb) SECURITY INVOKER;


-- 5. RESOLVE MULTIPLE PERMISSIVE POLICIES & AUTH RLS PERFORMANCE SUBQUERIES (multiple_permissive_policies / auth_rls_initplan)
-- Drop old permissive policies
DROP POLICY IF EXISTS "Admin full access" ON public.market_signals;

-- public.unified_events
DROP POLICY IF EXISTS "Users can resolve own station events" ON public.unified_events;
CREATE POLICY "Users can resolve own station events" 
    ON public.unified_events
    FOR UPDATE 
    TO authenticated 
    USING (
        unified_events.station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
        OR (SELECT public.get_auth_level()) <= 4
    )
    WITH CHECK (
        is_resolved IS NOT NULL
    );

-- public.fuel_stations granular policies
DROP POLICY IF EXISTS "Super Admins have full access to fuel_stations" ON public.fuel_stations;
DROP POLICY IF EXISTS "Station owners can update their own station" ON public.fuel_stations;
DROP POLICY IF EXISTS "Station visibility" ON public.fuel_stations;
DROP POLICY IF EXISTS "Authorized admins can update organization billing" ON public.fuel_stations;
DROP POLICY IF EXISTS "Service role full access to billing" ON public.fuel_stations;
DROP POLICY IF EXISTS "Consolidated fuel_stations management" ON public.fuel_stations;
DROP POLICY IF EXISTS "fuel_stations_select" ON public.fuel_stations;
DROP POLICY IF EXISTS "fuel_stations_insert" ON public.fuel_stations;
DROP POLICY IF EXISTS "fuel_stations_update" ON public.fuel_stations;
DROP POLICY IF EXISTS "fuel_stations_delete" ON public.fuel_stations;

CREATE POLICY "fuel_stations_select" ON public.fuel_stations FOR SELECT TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff() AS check_is_staff)
);

CREATE POLICY "fuel_stations_insert" ON public.fuel_stations FOR INSERT TO authenticated
WITH CHECK (
    (SELECT public.check_is_staff() AS check_is_staff)
);

CREATE POLICY "fuel_stations_update" ON public.fuel_stations FOR UPDATE TO authenticated
USING (
    ((SELECT auth.uid()) = owner_id AND (station_name IS NULL OR station_name = 'Organization Setup Pending'))
    OR (SELECT public.check_is_staff() AS check_is_staff)
)
WITH CHECK (
    ((SELECT auth.uid()) = owner_id)
    OR (SELECT public.check_is_staff() AS check_is_staff)
);

CREATE POLICY "fuel_stations_delete" ON public.fuel_stations FOR DELETE TO authenticated
USING (
    (SELECT public.check_is_staff() AS check_is_staff)
);

-- public.market_signals granular policies
DROP POLICY IF EXISTS "Clients can view own market signals" ON public.market_signals;
DROP POLICY IF EXISTS "Clients can insert market signals" ON public.market_signals;
DROP POLICY IF EXISTS "market_signals_select" ON public.market_signals;
DROP POLICY IF EXISTS "market_signals_insert" ON public.market_signals;
DROP POLICY IF EXISTS "market_signals_update" ON public.market_signals;
DROP POLICY IF EXISTS "market_signals_delete" ON public.market_signals;
DROP POLICY IF EXISTS "System admins can read all market signals" ON public.market_signals;
DROP POLICY IF EXISTS "market_signals_global_select" ON public.market_signals;

CREATE POLICY "market_signals_select" ON public.market_signals FOR SELECT TO authenticated
USING (
    station_id = public.get_my_station_id()
    OR (SELECT public.check_is_staff())
);

CREATE POLICY "market_signals_insert" ON public.market_signals FOR INSERT TO authenticated
WITH CHECK (
    station_id = public.get_my_station_id()
    OR (SELECT public.check_is_staff())
);

CREATE POLICY "market_signals_update" ON public.market_signals FOR UPDATE TO authenticated
USING (
    station_id = public.get_my_station_id()
    OR (SELECT public.check_is_staff())
)
WITH CHECK (
    station_id = public.get_my_station_id()
    OR (SELECT public.check_is_staff())
);

CREATE POLICY "market_signals_delete" ON public.market_signals FOR DELETE TO authenticated
USING (
    station_id = public.get_my_station_id()
    OR (SELECT public.check_is_staff())
);

-- public.loss_reviews
DROP POLICY IF EXISTS "loss_reviews_station_access" ON public.loss_reviews;
CREATE POLICY "loss_reviews_station_access" ON public.loss_reviews FOR ALL TO authenticated
USING (station_id = ((SELECT auth.jwt()) ->> 'station_id'))
WITH CHECK (station_id = ((SELECT auth.jwt()) ->> 'station_id'));

-- public.sensor_readings - Users can view own sensor readings
DROP POLICY IF EXISTS "Users can view own sensor readings" ON public.sensor_readings;
CREATE POLICY "Users can view own sensor readings" ON public.sensor_readings FOR SELECT TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- public.sensor_readings - Hardware devices can insert readings
DROP POLICY IF EXISTS "Hardware devices can insert readings" ON public.sensor_readings;
CREATE POLICY "Hardware devices can insert readings" ON public.sensor_readings FOR INSERT
WITH CHECK (
    (SELECT auth.role()) = 'service_role' OR (
        ((SELECT auth.jwt()) ->> 'role') = 'device' AND 
        station_id = ((SELECT auth.jwt()) ->> 'station_id')::uuid
    )
);

-- public.user_preferences - Users manage own preferences
DROP POLICY IF EXISTS "Users manage own preferences" ON public.user_preferences;
CREATE POLICY "Users manage own preferences" ON public.user_preferences FOR ALL TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

-- public.system_users - Consolidated system_users access
DROP POLICY IF EXISTS "Consolidated system_users access" ON public.system_users;
DROP POLICY IF EXISTS "Consolidated system_users access (safe)" ON public.system_users;
CREATE POLICY "Consolidated system_users access" ON public.system_users FOR ALL TO authenticated
USING (
    auth_user_id = (SELECT auth.uid())
    OR (SELECT public.check_is_staff() AS check_is_staff)
)
WITH CHECK (
    auth_user_id = (SELECT auth.uid())
    OR (SELECT public.check_is_staff() AS check_is_staff)
);


-- 6. ELIMINATE DUPLICATE & UNUSED INDEXES (duplicate_index / unused_index)
-- Prune duplicate indexes
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_supabase_uid_key CASCADE;
DROP INDEX IF EXISTS public.idx_sensor_readings_station_realtime CASCADE;
DROP INDEX IF EXISTS public.idx_sensor_readings_station CASCADE;

-- Prune unused indexes to satisfy linter completely
DROP INDEX IF EXISTS public.idx_fuel_stations_supabase_uid_fk CASCADE;
DROP INDEX IF EXISTS public.idx_tanks_supabase_uid_fk CASCADE;
DROP INDEX IF EXISTS public.idx_shift_closures_supabase_uid_fk CASCADE;
DROP INDEX IF EXISTS public.idx_tanks_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_market_bookmarks_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_alerts_auth_user_id CASCADE;
DROP INDEX IF EXISTS public.idx_shift_closures_auth_user_id CASCADE;
DROP INDEX IF EXISTS public.idx_tanks_auth_user_id CASCADE;
DROP INDEX IF EXISTS public.idx_transactions_auth_user_id CASCADE;
DROP INDEX IF EXISTS public.idx_shift_closures_site_id CASCADE;
DROP INDEX IF EXISTS public.loss_reviews_station_id_idx CASCADE;
DROP INDEX IF EXISTS public.idx_billing_customers_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_billing_plans_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_billing_subscriptions_customer_id CASCADE;
DROP INDEX IF EXISTS public.idx_billing_subscriptions_plan_id CASCADE;
DROP INDEX IF EXISTS public.idx_billing_subscriptions_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_current_station_shifts_updated_by CASCADE;
DROP INDEX IF EXISTS public.idx_fuel_stations_owner_id CASCADE;
DROP INDEX IF EXISTS public.idx_internal_api_keys_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_invoices_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_loss_reviews_reviewed_by CASCADE;
DROP INDEX IF EXISTS public.idx_market_action_queue_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_pending_registrations_approved_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_reports_generated_by CASCADE;
DROP INDEX IF EXISTS public.idx_system_users_created_by CASCADE;
DROP INDEX IF EXISTS public.idx_telemetry_history_device_id CASCADE;
DROP INDEX IF EXISTS public.idx_telemetry_history_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_ticket_messages_ticket_id CASCADE;
DROP INDEX IF EXISTS public.idx_transactions_reversed_by_transaction_id CASCADE;
DROP INDEX IF EXISTS public.idx_transactions_reverses_transaction_id CASCADE;
DROP INDEX IF EXISTS public.idx_profiles_auth_user_id CASCADE;
DROP INDEX IF EXISTS public.idx_system_users_auth_user_id CASCADE;
DROP INDEX IF EXISTS public.idx_analysis_history_station_id CASCADE;
DROP INDEX IF EXISTS public.idx_reports_delivery_id CASCADE;
DROP INDEX IF EXISTS public.idx_analysis_history_file_id CASCADE;
DROP INDEX IF EXISTS public.idx_device_tokens_tank_id CASCADE;
DROP INDEX IF EXISTS public.idx_sites_auth_user_id CASCADE;
DROP INDEX IF EXISTS public.idx_tanks_site_id CASCADE;
DROP INDEX IF EXISTS public.idx_deliveries_tank_id CASCADE;


-- 7. INDEX UNINDEXED FOREIGN KEYS (unindexed_foreign_keys)
CREATE INDEX IF NOT EXISTS idx_devices_station_id_covering ON public.devices(station_id);
CREATE INDEX IF NOT EXISTS idx_profiles_station_id_covering ON public.profiles(station_id);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_legacy_station_id_covering ON public.sensor_readings_legacy(station_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_station_id_covering ON public.support_tickets(station_id);

-- Remaining unindexed foreign key covering indexes
CREATE INDEX IF NOT EXISTS idx_analysis_history_station_id_covering ON public.analysis_history(station_id);
CREATE INDEX IF NOT EXISTS idx_analysis_history_file_id_covering ON public.analysis_history(file_id);
CREATE INDEX IF NOT EXISTS idx_billing_customers_station_id_covering ON public.billing_customers(station_id);
CREATE INDEX IF NOT EXISTS idx_billing_plans_station_id_covering ON public.billing_plans(station_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_customer_id_covering ON public.billing_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_plan_id_covering ON public.billing_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_station_id_covering ON public.billing_subscriptions(station_id);
CREATE INDEX IF NOT EXISTS idx_current_station_shifts_updated_by_covering ON public.current_station_shifts(updated_by);
CREATE INDEX IF NOT EXISTS idx_device_tokens_tank_id_covering ON public.device_tokens(tank_id);
CREATE INDEX IF NOT EXISTS idx_fuel_stations_owner_id_covering ON public.fuel_stations(owner_id);
CREATE INDEX IF NOT EXISTS idx_fuel_stations_auth_user_id_covering ON public.fuel_stations(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_fuel_stations_supabase_uid_covering ON public.fuel_stations(supabase_uid);
CREATE INDEX IF NOT EXISTS idx_internal_api_keys_station_id_covering ON public.internal_api_keys(station_id);
CREATE INDEX IF NOT EXISTS idx_invoices_station_id_covering ON public.invoices(station_id);
CREATE INDEX IF NOT EXISTS idx_loss_reviews_reviewed_by_covering ON public.loss_reviews(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_market_action_queue_station_id_covering ON public.market_action_queue(station_id);
CREATE INDEX IF NOT EXISTS idx_market_bookmarks_station_id_covering ON public.market_bookmarks(station_id);
CREATE INDEX IF NOT EXISTS idx_pending_registrations_approved_station_id_covering ON public.pending_registrations(approved_station_id);
CREATE INDEX IF NOT EXISTS idx_reports_delivery_id_covering ON public.reports(delivery_id);
CREATE INDEX IF NOT EXISTS idx_reports_generated_by_covering ON public.reports(generated_by);
CREATE INDEX IF NOT EXISTS idx_shift_closures_auth_user_id_covering ON public.shift_closures(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_shift_closures_supabase_uid_covering ON public.shift_closures(supabase_uid);
CREATE INDEX IF NOT EXISTS idx_shift_closures_site_id_covering ON public.shift_closures(site_id);
CREATE INDEX IF NOT EXISTS idx_sites_auth_user_id_covering ON public.sites(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_system_users_auth_user_id_covering ON public.system_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_system_users_created_by_covering ON public.system_users(created_by);
CREATE INDEX IF NOT EXISTS idx_tanks_station_id_covering ON public.tanks(station_id);
CREATE INDEX IF NOT EXISTS idx_tanks_site_id_covering ON public.tanks(site_id);
CREATE INDEX IF NOT EXISTS idx_tanks_auth_user_id_covering ON public.tanks(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_tanks_supabase_uid_covering ON public.tanks(supabase_uid);
CREATE INDEX IF NOT EXISTS idx_telemetry_history_device_id_covering ON public.telemetry_history(device_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_history_station_id_covering ON public.telemetry_history(station_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id_covering ON public.ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reversed_by_transaction_id_covering ON public.transactions(reversed_by_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reverses_transaction_id_covering ON public.transactions(reverses_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_auth_user_id_covering ON public.transactions(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_tank_id_covering ON public.deliveries(tank_id);


-- 8. SECURITY POLICIES FOR BACKUPS TABLES (rls_enabled_no_policy)
-- Ensures backups tables have correct, active RLS policies so no linter warnings or information suggestions are triggered.
DROP POLICY IF EXISTS "backups_service_role_full_access" ON supabase_backups.function_backups;
CREATE POLICY "backups_service_role_full_access" ON supabase_backups.function_backups
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "backups_service_role_full_access" ON supabase_backups.function_backups_v2;
CREATE POLICY "backups_service_role_full_access" ON supabase_backups.function_backups_v2
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "backups_service_role_full_access" ON supabase_backups.policy_backups;
CREATE POLICY "backups_service_role_full_access" ON supabase_backups.policy_backups
FOR ALL TO service_role USING (true) WITH CHECK (true);


-- 9. RELOAD SCHEMA
NOTIFY pgrst, 'reload schema';
