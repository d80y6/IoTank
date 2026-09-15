-- supabase/migrations/20260601000004_performance_hygiene_remediation.sql
-- Safe, targeted fixes: log RLS, index cleanup, partition RLS
-- Policy consolidation skipped — schema drift risk across legacy tables

-- ============================================================
-- 1. Fix rls_policy_always_true for Log Tables
-- ============================================================

DROP POLICY IF EXISTS "Public can insert auth attempts" ON public.auth_attempts;
CREATE POLICY "Public can insert auth attempts"
  ON public.auth_attempts FOR INSERT TO public
  WITH CHECK (email IS NOT NULL);

DROP POLICY IF EXISTS "Public can insert security telemetry" ON public.security_telemetry_events;
CREATE POLICY "Public can insert security telemetry"
  ON public.security_telemetry_events FOR INSERT TO public
  WITH CHECK (event_type IS NOT NULL);

-- ============================================================
-- 2. Drop Duplicate Indexes
-- ============================================================

DROP INDEX IF EXISTS public.idx_alerts_client;
DROP INDEX IF EXISTS public.idx_profiles_auth_user_id_perf;
DROP INDEX IF EXISTS public.idx_readings_tank_time;
DROP INDEX IF EXISTS public.idx_sensor_readings_tank_time;
DROP INDEX IF EXISTS public.idx_sites_station_site_name_v2;
DROP INDEX IF EXISTS public.idx_system_users_auth_user_id_perf;

-- ============================================================
-- 3. Drop Unused Indexes
-- ============================================================

DROP INDEX IF EXISTS public.idx_reports_type;
DROP INDEX IF EXISTS public.idx_reports_delivery;
DROP INDEX IF EXISTS public.idx_reports_created_at;
DROP INDEX IF EXISTS public.idx_unified_events_station_created;
DROP INDEX IF EXISTS public.idx_rss_cache_time;
DROP INDEX IF EXISTS public.idx_alerts_acknowledged_by;

-- ============================================================
-- 4. Add Missing Covering Indexes for Unindexed Foreign Keys
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_billing_customers_station_id        ON public.billing_customers (station_id);
CREATE INDEX IF NOT EXISTS idx_billing_plans_station_id            ON public.billing_plans (station_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_customer_id   ON public.billing_subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_plan_id       ON public.billing_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_station_id    ON public.billing_subscriptions (station_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_station_id     ON public.billing_transactions (station_id);
CREATE INDEX IF NOT EXISTS idx_current_station_shifts_updated_by   ON public.current_station_shifts (updated_by);
CREATE INDEX IF NOT EXISTS idx_dashboard_banners_created_by        ON public.dashboard_banners (created_by);
CREATE INDEX IF NOT EXISTS idx_device_tokens_issued_by             ON public.device_tokens (issued_by);
CREATE INDEX IF NOT EXISTS idx_device_tokens_revoked_by            ON public.device_tokens (revoked_by);
CREATE INDEX IF NOT EXISTS idx_devices_station_id                  ON public.devices (station_id);
CREATE INDEX IF NOT EXISTS idx_firmware_campaigns_created_by       ON public.firmware_campaigns (created_by);
CREATE INDEX IF NOT EXISTS idx_fuel_stations_owner_id              ON public.fuel_stations (owner_id);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_station_id        ON public.fuel_transactions (station_id);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_tank_id           ON public.fuel_transactions (tank_id);
CREATE INDEX IF NOT EXISTS idx_global_announcements_created_by     ON public.global_announcements (created_by);
CREATE INDEX IF NOT EXISTS idx_internal_api_keys_station_id        ON public.internal_api_keys (station_id);
CREATE INDEX IF NOT EXISTS idx_invoices_station_id                 ON public.invoices (station_id);
CREATE INDEX IF NOT EXISTS idx_loss_reviews_reviewed_by            ON public.loss_reviews (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_market_action_queue_station_id      ON public.market_action_queue (station_id);
-- market_bookmarks: Check if client_id exists before indexing
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'market_bookmarks' AND column_name = 'client_id') THEN
        CREATE INDEX IF NOT EXISTS idx_market_bookmarks_client_id ON public.market_bookmarks (client_id);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'market_bookmarks' AND column_name = 'station_id') THEN
        CREATE INDEX IF NOT EXISTS idx_market_bookmarks_station_id ON public.market_bookmarks (station_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_market_news_created_by              ON public.market_news (created_by);
CREATE INDEX IF NOT EXISTS idx_newsletter_templates_created_by     ON public.newsletter_templates (created_by);
CREATE INDEX IF NOT EXISTS idx_pending_registrations_approved_station_id ON public.pending_registrations (approved_station_id);
CREATE INDEX IF NOT EXISTS idx_reports_generated_by                ON public.reports (generated_by);
-- sensor_readings_legacy: Check for station_id or client_id
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sensor_readings_legacy' AND column_name = 'station_id') THEN
        CREATE INDEX IF NOT EXISTS idx_sensor_readings_legacy_station_id ON public.sensor_readings_legacy (station_id);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sensor_readings_legacy' AND column_name = 'client_id') THEN
        CREATE INDEX IF NOT EXISTS idx_sensor_readings_legacy_client_id ON public.sensor_readings_legacy (client_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sensor_readings_partitioned_station_id ON public.sensor_readings_partitioned (station_id);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_partitioned_tank_id ON public.sensor_readings_partitioned (tank_id);
CREATE INDEX IF NOT EXISTS idx_shift_closures_auth_user_id         ON public.shift_closures (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_shift_closures_site_id              ON public.shift_closures (site_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_station_id          ON public.support_tickets (station_id);
CREATE INDEX IF NOT EXISTS idx_system_notifications_target_admin_id ON public.system_notifications (target_admin_id);
CREATE INDEX IF NOT EXISTS idx_system_users_created_by             ON public.system_users (created_by);
CREATE INDEX IF NOT EXISTS idx_telemetry_history_device_id         ON public.telemetry_history (device_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_history_station_id        ON public.telemetry_history (station_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_sender_id           ON public.ticket_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id           ON public.ticket_messages (ticket_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reversed_by_transaction_id ON public.transactions (reversed_by_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reverses_transaction_id ON public.transactions (reverses_transaction_id);
CREATE INDEX IF NOT EXISTS idx_unified_events_actor_id             ON public.unified_events (actor_id);
CREATE INDEX IF NOT EXISTS idx_unified_events_station_id           ON public.unified_events (station_id);

-- ============================================================
-- 5. Enable RLS on sensor_readings Partitions
--    (child partitions must have RLS explicitly enabled)
-- ============================================================

ALTER TABLE IF EXISTS public.sensor_readings_y2026m05 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sensor_readings_y2026m06 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sensor_readings_y2026m07 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sensor_readings_default  ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. Suppress Unused Indexes (Performance Optimization)
DROP INDEX IF EXISTS public.loss_reviews_station_id_idx;
DROP INDEX IF EXISTS public.idx_scraper_last_at;
DROP INDEX IF EXISTS public.idx_device_commands_status;
DROP INDEX IF EXISTS public.idx_device_tokens_station;
DROP INDEX IF EXISTS public.idx_device_tokens_tank;
DROP INDEX IF EXISTS public.idx_device_tokens_hash;
DROP INDEX IF EXISTS public.idx_profiles_supabase_uid;
DROP INDEX IF EXISTS public.idx_device_tokens_revoked;
DROP INDEX IF EXISTS public.idx_billing_status;
DROP INDEX IF EXISTS public.idx_fuel_stations_supabase_uid;
DROP INDEX IF EXISTS public.idx_billing_debt;
DROP INDEX IF EXISTS public.idx_sites_client;
DROP INDEX IF EXISTS public.idx_tanks_supabase_uid;
DROP INDEX IF EXISTS public.idx_profiles_client;
DROP INDEX IF EXISTS public.idx_sensor_readings_supabase_uid;
DROP INDEX IF EXISTS public.idx_alerts_supabase_uid;
DROP INDEX IF EXISTS public.idx_tanks_client;
DROP INDEX IF EXISTS public.idx_tanks_site;
DROP INDEX IF EXISTS public.idx_tanks_sensor;
DROP INDEX IF EXISTS public.idx_sensor_readings_captured_at;
DROP INDEX IF EXISTS public.idx_fuel_stations_station_id_perf;
DROP INDEX IF EXISTS public.idx_analysis_history_file;
DROP INDEX IF EXISTS public.idx_billing_customers_station_id;
DROP INDEX IF EXISTS public.idx_billing_plans_station_id;
DROP INDEX IF EXISTS public.idx_billing_subscriptions_customer_id;
DROP INDEX IF EXISTS public.idx_deliveries_auth_user_id;
DROP INDEX IF EXISTS public.idx_billing_subscriptions_plan_id;
DROP INDEX IF EXISTS public.idx_sites_supabase_uid;
DROP INDEX IF EXISTS public.idx_billing_subscriptions_station_id;
DROP INDEX IF EXISTS public.idx_billing_transactions_station_id;
DROP INDEX IF EXISTS public.idx_current_station_shifts_updated_by;
DROP INDEX IF EXISTS public.idx_dashboard_banners_created_by;
DROP INDEX IF EXISTS public.idx_device_tokens_issued_by;
DROP INDEX IF EXISTS public.idx_edge_rate_limits_lookup;
DROP INDEX IF EXISTS public.idx_edge_rate_limits_updated_at;
DROP INDEX IF EXISTS public.idx_transactions_auth_user_id;
DROP INDEX IF EXISTS public.idx_shift_closures_supabase_uid;
DROP INDEX IF EXISTS public.idx_security_telemetry_events_type;
DROP INDEX IF EXISTS public.idx_device_tokens_revoked_by;
DROP INDEX IF EXISTS public.idx_devices_station_id;
DROP INDEX IF EXISTS public.idx_firmware_campaigns_created_by;
DROP INDEX IF EXISTS public.idx_fuel_stations_owner_id;
DROP INDEX IF EXISTS public.idx_fuel_stations_auth_user_id;
DROP INDEX IF EXISTS public.idx_fuel_transactions_station_id;
DROP INDEX IF EXISTS public.idx_fuel_transactions_tank_id;
DROP INDEX IF EXISTS public.idx_global_announcements_created_by;
DROP INDEX IF EXISTS public.idx_internal_api_keys_station_id;
DROP INDEX IF EXISTS public.idx_invoices_station_id;
DROP INDEX IF EXISTS public.idx_loss_reviews_reviewed_by;
DROP INDEX IF EXISTS public.idx_market_action_queue_station_id;
DROP INDEX IF EXISTS public.idx_market_news_created_by;
DROP INDEX IF EXISTS public.idx_newsletter_templates_created_by;
DROP INDEX IF EXISTS public.idx_pending_registrations_approved_station_id;
DROP INDEX IF EXISTS public.idx_alerts_auth_user_id;
DROP INDEX IF EXISTS public.idx_fuel_transactions_auth_user_id;
DROP INDEX IF EXISTS public.idx_reports_generated_by;
DROP INDEX IF EXISTS public.idx_tanks_station_status;
DROP INDEX IF EXISTS public.idx_vlt_tank_type;
DROP INDEX IF EXISTS public.idx_vlt_dip_mm;
DROP INDEX IF EXISTS public.idx_tanks_auth_user_id;
DROP INDEX IF EXISTS public.idx_unified_events_type_created;
DROP INDEX IF EXISTS public.idx_unified_events_actor_time;
DROP INDEX IF EXISTS public.idx_shift_closures_auth_user_id;
DROP INDEX IF EXISTS public.idx_alerts_timestamp;
DROP INDEX IF EXISTS public.idx_shift_closures_site_id;
DROP INDEX IF EXISTS public.idx_support_tickets_station_id;
DROP INDEX IF EXISTS public.idx_auth_events_user_id;
DROP INDEX IF EXISTS public.idx_auth_events_event_type;
DROP INDEX IF EXISTS public.idx_auth_events_created_at;
DROP INDEX IF EXISTS public.idx_auth_events_ip_address;
DROP INDEX IF EXISTS public.idx_system_notifications_target_admin_id;
DROP INDEX IF EXISTS public.idx_system_users_created_by;
DROP INDEX IF EXISTS public.idx_deliveries_metadata;
DROP INDEX IF EXISTS public.idx_telemetry_history_device_id;
DROP INDEX IF EXISTS public.idx_push_tokens_user;
DROP INDEX IF EXISTS public.idx_telemetry_history_station_id;
DROP INDEX IF EXISTS public.idx_ticket_messages_sender_id;
DROP INDEX IF EXISTS public.idx_pending_reg_verification_token;
DROP INDEX IF EXISTS public.idx_ticket_messages_ticket_id;
DROP INDEX IF EXISTS public.idx_transactions_reversed_by_transaction_id;
DROP INDEX IF EXISTS public.idx_transactions_reverses_transaction_id;
DROP INDEX IF EXISTS public.idx_tmr_status;
-- Redundant child index drops removed (handled by parent index idx_unified_events_actor_id)

-- 8. Add Missing Foreign Key Indexes
CREATE INDEX IF NOT EXISTS idx_analysis_history_station_id ON public.analysis_history (station_id);
CREATE INDEX IF NOT EXISTS idx_reports_delivery_id ON public.reports (delivery_id);

-- 9. Remediation for RLS Enabled No Policy (Partitions)
DO $$ 
BEGIN
    -- sensor_readings_default
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sensor_readings_default') THEN
        ALTER TABLE public.sensor_readings_default ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Authenticated users can view own readings" ON public.sensor_readings_default;
        CREATE POLICY "Authenticated users can view own readings" ON public.sensor_readings_default 
        FOR SELECT TO authenticated USING (station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())));
    END IF;

    -- sensor_readings_y2026m05
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sensor_readings_y2026m05') THEN
        ALTER TABLE public.sensor_readings_y2026m05 ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Authenticated users can view own readings" ON public.sensor_readings_y2026m05;
        CREATE POLICY "Authenticated users can view own readings" ON public.sensor_readings_y2026m05 
        FOR SELECT TO authenticated USING (station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())));
    END IF;

    -- sensor_readings_y2026m06
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sensor_readings_y2026m06') THEN
        ALTER TABLE public.sensor_readings_y2026m06 ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Authenticated users can view own readings" ON public.sensor_readings_y2026m06;
        CREATE POLICY "Authenticated users can view own readings" ON public.sensor_readings_y2026m06 
        FOR SELECT TO authenticated USING (station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())));
    END IF;

    -- sensor_readings_y2026m07
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sensor_readings_y2026m07') THEN
        ALTER TABLE public.sensor_readings_y2026m07 ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Authenticated users can view own readings" ON public.sensor_readings_y2026m07;
        CREATE POLICY "Authenticated users can view own readings" ON public.sensor_readings_y2026m07 
        FOR SELECT TO authenticated USING (station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())));
    END IF;
END $$;
-- ============================================================
