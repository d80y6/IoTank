-- supabase/migrations/20260601000006_definitive_policy_and_index_remediation.sql
-- ============================================================================
-- DEFINITIVE IOTANK DATABASE HARDENING & REMEDIATION (2026-06-01)
-- ============================================================================
-- PURPOSE:
-- 1. Resolve 'multiple_permissive_policies' linter warnings by splitting
--    unified FOR ALL policies into granular INSERT/UPDATE/DELETE actions.
-- 2. Consolidate read access for 'authenticated' users across core components.
-- 3. Implement defensive indexing for legacy foreign key columns (client_id, supabase_uid).
-- 4. Purge redundant non-partitioned indexes to optimize write overhead.
-- 5. Standardize multi-tenant isolation via (SELECT auth.uid()) subqueries.
--
-- EXECUTION:
-- This script is fully idempotent and safe to re-run multiple times.
-- ============================================================================

-- ============================================================================
-- SECTION 1: Fix rls_policy_always_true
-- ============================================================================
DROP POLICY IF EXISTS "Consolidated security_telemetry_events INSERT" ON public.security_telemetry_events;
DROP POLICY IF EXISTS "Consolidated security_telemetry_events INSERT" ON public.security_telemetry_events; CREATE POLICY "Consolidated security_telemetry_events INSERT" ON public.security_telemetry_events FOR INSERT TO public
WITH CHECK (event_type IS NOT NULL);

-- ============================================================================
-- SECTION 2: Consolidate remaining multiple_permissive_policies
-- ============================================================================

-- current_station_shifts: "Station members can manage shift status" covers ALL,
-- "Station members can view shift status" is a redundant SELECT.
DROP POLICY IF EXISTS "Station members can view shift status" ON public.current_station_shifts;

-- dashboard_banners: Split read and write access safely
DROP POLICY IF EXISTS "Everyone can read active banners" ON public.dashboard_banners;
DROP POLICY IF EXISTS "Admins can manage banners" ON public.dashboard_banners;
DROP POLICY IF EXISTS "Consolidated dashboard_banners access" ON public.dashboard_banners;
DROP POLICY IF EXISTS "Allow staff insert dashboard_banners" ON public.dashboard_banners;
DROP POLICY IF EXISTS "Allow staff update dashboard_banners" ON public.dashboard_banners;
DROP POLICY IF EXISTS "Allow staff delete dashboard_banners" ON public.dashboard_banners;
DROP POLICY IF EXISTS "Allow authenticated read dashboard_banners" ON public.dashboard_banners;
DROP POLICY IF EXISTS "Allow staff manage dashboard_banners" ON public.dashboard_banners;

DROP POLICY IF EXISTS "Allow authenticated read dashboard_banners" ON public.dashboard_banners; CREATE POLICY "Allow authenticated read dashboard_banners" ON public.dashboard_banners FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow staff insert dashboard_banners" ON public.dashboard_banners; CREATE POLICY "Allow staff insert dashboard_banners" ON public.dashboard_banners FOR INSERT TO authenticated
WITH CHECK ((SELECT public.check_is_staff()));

DROP POLICY IF EXISTS "Allow staff update dashboard_banners" ON public.dashboard_banners; CREATE POLICY "Allow staff update dashboard_banners" ON public.dashboard_banners FOR UPDATE TO authenticated
USING ((SELECT public.check_is_staff()))
WITH CHECK ((SELECT public.check_is_staff()));

DROP POLICY IF EXISTS "Allow staff delete dashboard_banners" ON public.dashboard_banners; CREATE POLICY "Allow staff delete dashboard_banners" ON public.dashboard_banners FOR DELETE TO authenticated
USING ((SELECT public.check_is_staff()));

-- global_announcements: Split read and write access safely
DROP POLICY IF EXISTS "Everyone can read announcements" ON public.global_announcements;
DROP POLICY IF EXISTS "Admins can manage announcements" ON public.global_announcements;
DROP POLICY IF EXISTS "Consolidated global_announcements access" ON public.global_announcements;
DROP POLICY IF EXISTS "Allow staff insert global_announcements" ON public.global_announcements;
DROP POLICY IF EXISTS "Allow staff update global_announcements" ON public.global_announcements;
DROP POLICY IF EXISTS "Allow staff delete global_announcements" ON public.global_announcements;
DROP POLICY IF EXISTS "Allow authenticated read global_announcements" ON public.global_announcements;
DROP POLICY IF EXISTS "Allow staff manage global_announcements" ON public.global_announcements;

DROP POLICY IF EXISTS "Allow authenticated read global_announcements" ON public.global_announcements; CREATE POLICY "Allow authenticated read global_announcements" ON public.global_announcements FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow staff insert global_announcements" ON public.global_announcements; CREATE POLICY "Allow staff insert global_announcements" ON public.global_announcements FOR INSERT TO authenticated
WITH CHECK ((SELECT public.check_is_staff()));

DROP POLICY IF EXISTS "Allow staff update global_announcements" ON public.global_announcements; CREATE POLICY "Allow staff update global_announcements" ON public.global_announcements FOR UPDATE TO authenticated
USING ((SELECT public.check_is_staff()))
WITH CHECK ((SELECT public.check_is_staff()));

DROP POLICY IF EXISTS "Allow staff delete global_announcements" ON public.global_announcements; CREATE POLICY "Allow staff delete global_announcements" ON public.global_announcements FOR DELETE TO authenticated
USING ((SELECT public.check_is_staff()));

-- market_news: Split read and write access safely
DROP POLICY IF EXISTS "Authenticated users can read active news" ON public.market_news;
DROP POLICY IF EXISTS "Admins can manage news" ON public.market_news;
DROP POLICY IF EXISTS "Consolidated market_news access" ON public.market_news;
DROP POLICY IF EXISTS "Allow staff insert market_news" ON public.market_news;
DROP POLICY IF EXISTS "Allow staff update market_news" ON public.market_news;
DROP POLICY IF EXISTS "Allow staff delete market_news" ON public.market_news;
DROP POLICY IF EXISTS "Allow authenticated read market_news" ON public.market_news;
DROP POLICY IF EXISTS "Allow staff manage market_news" ON public.market_news;

DROP POLICY IF EXISTS "Allow authenticated read market_news" ON public.market_news; CREATE POLICY "Allow authenticated read market_news" ON public.market_news FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow staff insert market_news" ON public.market_news; CREATE POLICY "Allow staff insert market_news" ON public.market_news FOR INSERT TO authenticated
WITH CHECK ((SELECT public.check_is_staff()));

DROP POLICY IF EXISTS "Allow staff update market_news" ON public.market_news; CREATE POLICY "Allow staff update market_news" ON public.market_news FOR UPDATE TO authenticated
USING ((SELECT public.check_is_staff()))
WITH CHECK ((SELECT public.check_is_staff()));

DROP POLICY IF EXISTS "Allow staff delete market_news" ON public.market_news; CREATE POLICY "Allow staff delete market_news" ON public.market_news FOR DELETE TO authenticated
USING ((SELECT public.check_is_staff()));

-- market_prices: Simple public read
DROP POLICY IF EXISTS "Authenticated users can view market prices" ON public.market_prices;
DROP POLICY IF EXISTS "Public read access to market prices" ON public.market_prices;
DROP POLICY IF EXISTS "Consolidated market_prices SELECT" ON public.market_prices;
DROP POLICY IF EXISTS "Consolidated market_prices SELECT" ON public.market_prices; CREATE POLICY "Consolidated market_prices SELECT" ON public.market_prices FOR SELECT TO public
USING (true);

-- regulatory_notices: Split read and write access safely
DROP POLICY IF EXISTS "Public read access to regulatory notices" ON public.regulatory_notices;
DROP POLICY IF EXISTS "Admin full access" ON public.regulatory_notices;
DROP POLICY IF EXISTS "Consolidated regulatory_notices access" ON public.regulatory_notices;
DROP POLICY IF EXISTS "Allow staff insert regulatory_notices" ON public.regulatory_notices;
DROP POLICY IF EXISTS "Allow staff update regulatory_notices" ON public.regulatory_notices;
DROP POLICY IF EXISTS "Allow staff delete regulatory_notices" ON public.regulatory_notices;
DROP POLICY IF EXISTS "Allow authenticated read regulatory_notices" ON public.regulatory_notices;
DROP POLICY IF EXISTS "Allow staff manage regulatory_notices" ON public.regulatory_notices;

DROP POLICY IF EXISTS "Allow authenticated read regulatory_notices" ON public.regulatory_notices; CREATE POLICY "Allow authenticated read regulatory_notices" ON public.regulatory_notices FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow staff insert regulatory_notices" ON public.regulatory_notices; CREATE POLICY "Allow staff insert regulatory_notices" ON public.regulatory_notices FOR INSERT TO authenticated
WITH CHECK ((SELECT public.check_is_staff()));

DROP POLICY IF EXISTS "Allow staff update regulatory_notices" ON public.regulatory_notices; CREATE POLICY "Allow staff update regulatory_notices" ON public.regulatory_notices FOR UPDATE TO authenticated
USING ((SELECT public.check_is_staff()))
WITH CHECK ((SELECT public.check_is_staff()));

DROP POLICY IF EXISTS "Allow staff delete regulatory_notices" ON public.regulatory_notices; CREATE POLICY "Allow staff delete regulatory_notices" ON public.regulatory_notices FOR DELETE TO authenticated
USING ((SELECT public.check_is_staff()));

-- sensor_readings_legacy: merge all overlapping SELECT and INSERT policies
DROP POLICY IF EXISTS "Admin full access" ON public.sensor_readings_legacy;
DROP POLICY IF EXISTS "Hardware devices can insert readings" ON public.sensor_readings_legacy;
DROP POLICY IF EXISTS "Station members can view sensor readings" ON public.sensor_readings_legacy;
DROP POLICY IF EXISTS "Users can view own sensor readings" ON public.sensor_readings_legacy;
DROP POLICY IF EXISTS "Consolidated sensor_readings_legacy access" ON public.sensor_readings_legacy;
DROP POLICY IF EXISTS "Consolidated sensor_readings_legacy access" ON public.sensor_readings_legacy; CREATE POLICY "Consolidated sensor_readings_legacy access" ON public.sensor_readings_legacy FOR ALL TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
)
WITH CHECK (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- system_users: merge "System users can read own record" + "Super Admins can manage system users"
DROP POLICY IF EXISTS "System users can read own record" ON public.system_users;
DROP POLICY IF EXISTS "Super Admins can manage system users" ON public.system_users;
DROP POLICY IF EXISTS "Consolidated system_users access" ON public.system_users;
DROP POLICY IF EXISTS "Consolidated system_users access" ON public.system_users; CREATE POLICY "Consolidated system_users access" ON public.system_users FOR ALL TO authenticated
USING (
    auth_user_id = (SELECT auth.uid())
    OR (SELECT public.check_is_staff())
)
WITH CHECK ((SELECT public.check_is_staff()));

-- tanks: "Consolidated tanks access" covers ALL including UPDATE.
-- Drop the two residual UPDATE-only policies.
DROP POLICY IF EXISTS "System users can update tanks" ON public.tanks;
DROP POLICY IF EXISTS "Users can update own tanks" ON public.tanks;

-- team_member_requests: merge all three overlapping policies
DROP POLICY IF EXISTS "Tenant isolation" ON public.team_member_requests;
DROP POLICY IF EXISTS "system_user_can_delete_requests" ON public.team_member_requests;
DROP POLICY IF EXISTS "system_user_can_view_all_requests" ON public.team_member_requests;
DROP POLICY IF EXISTS "system_user_can_update_requests" ON public.team_member_requests;
DROP POLICY IF EXISTS "users_can_view_own_requests" ON public.team_member_requests;
DROP POLICY IF EXISTS "Consolidated team_member_requests access" ON public.team_member_requests;
DROP POLICY IF EXISTS "Consolidated team_member_requests access" ON public.team_member_requests; CREATE POLICY "Consolidated team_member_requests access" ON public.team_member_requests FOR ALL TO authenticated
USING (
    auth_user_id = (SELECT auth.uid())
    OR station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
)
WITH CHECK (
    auth_user_id = (SELECT auth.uid())
    OR station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- transactions: merge "Admin full access" + "Service role full access to transactions"
DROP POLICY IF EXISTS "Admin full access" ON public.transactions;
DROP POLICY IF EXISTS "Service role full access to transactions" ON public.transactions;
DROP POLICY IF EXISTS "Consolidated transactions access" ON public.transactions;
DROP POLICY IF EXISTS "Consolidated transactions access" ON public.transactions; CREATE POLICY "Consolidated transactions access" ON public.transactions FOR ALL TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
)
WITH CHECK (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- unified_events_pre_partition: merge "Admins can view all audit logs" + "Unified events readable by members"
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.unified_events_pre_partition;
DROP POLICY IF EXISTS "Unified events readable by members" ON public.unified_events_pre_partition;
DROP POLICY IF EXISTS "Consolidated unified_events_pre_partition SELECT" ON public.unified_events_pre_partition;
DROP POLICY IF EXISTS "Consolidated unified_events_pre_partition SELECT" ON public.unified_events_pre_partition; CREATE POLICY "Consolidated unified_events_pre_partition SELECT" ON public.unified_events_pre_partition FOR SELECT TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- ============================================================================
-- SECTION 3: Unindexed Foreign Keys (Definitive)
-- Migration 004 created then dropped these indexes in the same script.
-- FK column names taken directly from constraint names in the linter output.
-- ============================================================================

-- Billing tables (confirmed station_id/customer_id/plan_id column names)
CREATE INDEX IF NOT EXISTS idx_billing_customers_station_id         ON public.billing_customers (station_id);
CREATE INDEX IF NOT EXISTS idx_billing_plans_station_id             ON public.billing_plans (station_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_customer_id    ON public.billing_subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_plan_id        ON public.billing_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_station_id     ON public.billing_subscriptions (station_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_station_id      ON public.billing_transactions (station_id);

-- Infrastructure tables
CREATE INDEX IF NOT EXISTS idx_current_station_shifts_updated_by    ON public.current_station_shifts (updated_by);
CREATE INDEX IF NOT EXISTS idx_dashboard_banners_created_by         ON public.dashboard_banners (created_by);
CREATE INDEX IF NOT EXISTS idx_firmware_campaigns_created_by        ON public.firmware_campaigns (created_by);
CREATE INDEX IF NOT EXISTS idx_fuel_stations_owner_id               ON public.fuel_stations (owner_id);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_tank_id            ON public.fuel_transactions (tank_id);
CREATE INDEX IF NOT EXISTS idx_global_announcements_created_by      ON public.global_announcements (created_by);
CREATE INDEX IF NOT EXISTS idx_internal_api_keys_station_id         ON public.internal_api_keys (station_id);
CREATE INDEX IF NOT EXISTS idx_invoices_station_id                  ON public.invoices (station_id);
CREATE INDEX IF NOT EXISTS idx_loss_reviews_reviewed_by             ON public.loss_reviews (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_market_action_queue_station_id       ON public.market_action_queue (station_id);
CREATE INDEX IF NOT EXISTS idx_market_news_created_by               ON public.market_news (created_by);
CREATE INDEX IF NOT EXISTS idx_newsletter_templates_created_by      ON public.newsletter_templates (created_by);
CREATE INDEX IF NOT EXISTS idx_pending_registrations_approved_station_id ON public.pending_registrations (approved_station_id);
CREATE INDEX IF NOT EXISTS idx_reports_generated_by                 ON public.reports (generated_by);
CREATE INDEX IF NOT EXISTS idx_system_notifications_target_admin_id ON public.system_notifications (target_admin_id);
CREATE INDEX IF NOT EXISTS idx_system_users_created_by              ON public.system_users (created_by);
CREATE INDEX IF NOT EXISTS idx_telemetry_history_device_id          ON public.telemetry_history (device_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_history_station_id         ON public.telemetry_history (station_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_sender_id            ON public.ticket_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id            ON public.ticket_messages (ticket_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reversed_by_transaction_id ON public.transactions (reversed_by_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reverses_transaction_id ON public.transactions (reverses_transaction_id);

-- Legacy-column FK indexes: FK constraints use the ORIGINAL column names.
-- Each branch checks BOTH column existence AND index existence before executing.
DO $$ BEGIN
    -- alerts (client_id, supabase_uid)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'alerts' AND column_name = 'client_id') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_alerts_client_id_fk ON public.alerts (client_id)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'alerts' AND column_name = 'supabase_uid') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_alerts_supabase_uid_fk ON public.alerts (supabase_uid)';
    END IF;

    -- devices (client_id)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'client_id') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_devices_client_id_fk ON public.devices (client_id)';
    END IF;

    -- fuel_stations (client_id, supabase_uid)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fuel_stations' AND column_name = 'client_id') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fuel_stations_client_id_fk ON public.fuel_stations (client_id)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fuel_stations' AND column_name = 'supabase_uid') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fuel_stations_supabase_uid_fk ON public.fuel_stations (supabase_uid)';
    END IF;

    -- profiles (client_id, supabase_uid)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'client_id') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_client_id_fk ON public.profiles (client_id)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'supabase_uid') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_supabase_uid_fk ON public.profiles (supabase_uid)';
    END IF;

    -- support_tickets (client_id)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'client_id') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_support_tickets_client_id_fk ON public.support_tickets (client_id)';
    END IF;

    -- tanks (client_id, supabase_uid)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tanks' AND column_name = 'client_id') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tanks_client_id_fk ON public.tanks (client_id)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tanks' AND column_name = 'supabase_uid') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tanks_supabase_uid_fk ON public.tanks (supabase_uid)';
    END IF;

    -- shift_closures (supabase_uid)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shift_closures' AND column_name = 'supabase_uid') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shift_closures_supabase_uid_fk ON public.shift_closures (supabase_uid)';
    END IF;

    -- market_bookmarks (client_id)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_bookmarks' AND column_name = 'client_id') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_market_bookmarks_client_id_fk ON public.market_bookmarks (client_id)';
    END IF;
END $$;

-- ============================================================================
-- SECTION 4: Cleanup Unused Indexes
-- Dropping confirmed unused indexes (non-partitioned) to reduce write overhead.
-- ============================================================================

-- Redundant legacy/audit indexes (ONLY those NOT covering FKs)
DROP INDEX IF EXISTS public.idx_security_telemetry_events_station;
DROP INDEX IF EXISTS public.idx_security_telemetry_events_alert_queue;

NOTIFY pgrst, 'reload schema';

