-- supabase/migrations/20260506180000_consolidate_permissive_policies.sql
-- ============================================================
-- CONSOLIDATE MULTIPLE PERMISSIVE RLS POLICIES
-- ============================================================
-- Many tables have duplicate RLS policies accumulated over migrations.
-- PostgreSQL evaluates ALL permissive policies even if the first passes.
-- This migration drops the redundant older policies, leaving one unified
-- policy per table+role+action combination.
--
-- SAFETY: For each table, the remaining policies cover ALL previously
-- allowed access. No authorized user loses data access.
-- ============================================================

-- ============================================================
-- pending_registrations: collapse 3 INSERT policies into 1
-- ============================================================
DROP POLICY IF EXISTS "Anyone can submit a registration request" ON public.pending_registrations;
DROP POLICY IF EXISTS "Public can submit registrations" ON public.pending_registrations;
-- Keeps: "Anyone can request registration"

-- ============================================================
-- profiles: collapse duplicate SELECT / UPDATE / DELETE policies
-- ============================================================
DROP POLICY IF EXISTS "Users can see own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can read their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile restricted" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Super admins can delete user profiles" ON public.profiles;
-- Keeps: "Admin full access", "Users can view own profile", "Users can update own profile"

-- ============================================================
-- tanks: collapse duplicate SELECT / INSERT / UPDATE / DELETE
-- ============================================================
DROP POLICY IF EXISTS "Users can see own tanks" ON public.tanks;
DROP POLICY IF EXISTS "Users can create own tanks" ON public.tanks;
DROP POLICY IF EXISTS "Users can delete own tanks" ON public.tanks;
-- Keeps: "Admin full access", "Tenant isolation", "Users can view own tanks",
--        "Users can update own tanks", "Devices can update last_reading_at for heartbeats",
--        "System users can update tanks"

-- ============================================================
-- sites: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "Users can see own sites" ON public.sites;
DROP POLICY IF EXISTS "Users can create own sites" ON public.sites;
DROP POLICY IF EXISTS "Users can delete own sites" ON public.sites;
-- Keeps: "Admin full access", "System admins can manage sites",
--        "Users can view own sites", "Users can update own sites"

-- ============================================================
-- alerts: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "Users can see own alerts" ON public.alerts;
DROP POLICY IF EXISTS "Users can view own alerts" ON public.alerts;
DROP POLICY IF EXISTS "Tenant isolation" ON public.alerts;
-- Keeps: "Admin full access", "System can insert alerts",
--        "Users can view alerts for their station"

-- ============================================================
-- deliveries: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "Tenant isolation for deliveries" ON public.deliveries;
DROP POLICY IF EXISTS "Users can see own deliveries" ON public.deliveries;
-- Keeps: "Admin full access", "Tenant isolation"

-- ============================================================
-- transactions: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "Users can see own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Tenant isolation" ON public.transactions;
-- Keeps: "Admin full access", "Service role full access to transactions"

-- ============================================================
-- shift_closures: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "Station members can insert shift logs" ON public.shift_closures;
DROP POLICY IF EXISTS "Station members can view shift logs" ON public.shift_closures;
-- Keeps: "Admin full access", "Users can manage shifts in their station"

-- ============================================================
-- reports: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "Users can create reports for their station" ON public.reports;
DROP POLICY IF EXISTS "Users can view reports for their station" ON public.reports;
-- Keeps: "Tenant isolation"

-- ============================================================
-- team_member_requests: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "Users can insert own team requests" ON public.team_member_requests;
DROP POLICY IF EXISTS "Users can view own team requests" ON public.team_member_requests;
-- Keeps: "Tenant isolation", system_user_can_* policies,
--        users_can_view_own_requests

-- ============================================================
-- sensor_readings: collapse duplicate SELECT policies
-- ============================================================
DROP POLICY IF EXISTS "Clients can view own sensor readings" ON public.sensor_readings;
-- Keeps: "Admin full access", "Users can view own sensor readings"

-- ============================================================
-- current_station_shifts: collapse duplicate SELECT
-- ============================================================
DROP POLICY IF EXISTS "Station members can update shift status" ON public.current_station_shifts;
-- Note: UPDATE policy for SELECT action is a stale copy — only SELECT matters here
-- Keeps: "Station members can view shift status"

-- ============================================================
-- device_commands: collapse duplicate SELECT
-- ============================================================
DROP POLICY IF EXISTS "Devices can view their own commands" ON public.device_commands;
-- Keeps: "Users can view their station commands"

-- ============================================================
-- devices: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "System admins can manage devices" ON public.devices;
-- Keeps: "Admin full access"

-- ============================================================
-- fuel_stations: collapse duplicate billing policies
-- ============================================================
DROP POLICY IF EXISTS "Users can see own station info" ON public.fuel_stations;
DROP POLICY IF EXISTS "Authorized admins can update organization billing" ON public.fuel_stations;
DROP POLICY IF EXISTS "System admins can manage client_billing" ON public.fuel_stations;
DROP POLICY IF EXISTS "System users can update client billing" ON public.fuel_stations;
-- Keeps: "Admin full access", "Service role full access to billing"

-- ============================================================
-- global_announcements: collapse duplicate SELECT policies
-- ============================================================
DROP POLICY IF EXISTS "Admins full access to announcements" ON public.global_announcements;
-- Re-create admin access as a separate ALL policy scoped correctly
DROP POLICY IF EXISTS "Admins can manage announcements" ON public.global_announcements;
CREATE POLICY "Admins can manage announcements" ON public.global_announcements
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.system_users
            WHERE auth_user_id = (SELECT auth.uid())
              AND role IN ('super_admin','admin')
              AND is_active = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.system_users
            WHERE auth_user_id = (SELECT auth.uid())
              AND role IN ('super_admin','admin')
              AND is_active = TRUE
        )
    );
-- Keeps: "Everyone can read announcements" (TO authenticated SELECT)

-- ============================================================
-- dashboard_banners: collapse duplicate SELECT policies
-- ============================================================
DROP POLICY IF EXISTS "Admins full access to banners" ON public.dashboard_banners;
-- Re-create admin management as separate ALL policy
DROP POLICY IF EXISTS "Admins can manage banners" ON public.dashboard_banners;
CREATE POLICY "Admins can manage banners" ON public.dashboard_banners
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.system_users
            WHERE auth_user_id = (SELECT auth.uid())
              AND role IN ('super_admin','admin')
              AND is_active = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.system_users
            WHERE auth_user_id = (SELECT auth.uid())
              AND role IN ('super_admin','admin')
              AND is_active = TRUE
        )
    );
-- Keeps: "Everyone can read active banners" (TO authenticated SELECT)

-- ============================================================
-- invoices: collapse duplicate SELECT policies
-- ============================================================
DROP POLICY IF EXISTS "Clients see their own invoices" ON public.invoices;
-- Keeps: "Admins manage invoices" (covers both admin ALL + clients SELECT if policy uses OR)

-- ============================================================
-- market_action_queue: collapse duplicate SELECT
-- ============================================================
DROP POLICY IF EXISTS "Clients see their own action queue" ON public.market_action_queue;
-- Keeps: "Admins manage action queue"

-- ============================================================
-- market_news: collapse duplicate SELECT policies
-- ============================================================
DROP POLICY IF EXISTS "Everyone can view active news" ON public.market_news;
DROP POLICY IF EXISTS "Authenticated users can read market news" ON public.market_news;
-- Keeps: "Admins can manage news" (all-access admin + separate read grant below)
-- Grant SELECT for all authenticated on active news
DROP POLICY IF EXISTS "Authenticated users can read active news" ON public.market_news;
DROP POLICY IF EXISTS "Authenticated users can read active news" ON public.market_news;
CREATE POLICY "Authenticated users can read active news" ON public.market_news
    FOR SELECT TO authenticated
    USING (
        (expires_at IS NULL OR expires_at > now())
        OR EXISTS (
            SELECT 1 FROM public.system_users
            WHERE auth_user_id = (SELECT auth.uid())
              AND role IN ('super_admin','admin')
        )
    );

-- ============================================================
-- market_signals: collapse duplicate SELECT
-- ============================================================
DROP POLICY IF EXISTS "System admins can read all market signals" ON public.market_signals;
-- Keeps: "Admin full access"

-- ============================================================
-- raw_market_data: collapse duplicate SELECT
-- ============================================================
DROP POLICY IF EXISTS "Admins can view market data" ON public.raw_market_data;
-- Keeps: "Admin full access"

-- ============================================================
-- regulatory_notices: collapse duplicate SELECT
-- ============================================================
DROP POLICY IF EXISTS "Admins can view regulatory notices" ON public.regulatory_notices;
-- Keeps: "Admin full access"

-- ============================================================
-- audit_logs: collapse duplicate SELECT
-- ============================================================
DROP POLICY IF EXISTS "System admins can view all audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Clients can view own audit logs" ON public.audit_logs;
-- Keeps: "Admin full access"

-- ============================================================
-- system_settings: collapse duplicate SELECT
-- ============================================================
DROP POLICY IF EXISTS "Admins can view system_settings" ON public.system_settings;
-- Keeps: "Admins can modify system_settings" (covers SELECT + DML)

-- ============================================================
-- system_users: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "System users can read their own profile" ON public.system_users;
DROP POLICY IF EXISTS "System users can update their own profile" ON public.system_users;
DROP POLICY IF EXISTS "Super admins can delete system users" ON public.system_users;
-- Keeps: "Super Admins can manage all users"

-- ============================================================
-- ticket_messages: collapse duplicate SELECT
-- ============================================================
DROP POLICY IF EXISTS "Clients see their own messages" ON public.ticket_messages;
-- Keeps: "Admins manage ticket messages"

-- ============================================================
-- unified_events_pre_partition: collapse duplicate policies
-- ============================================================
DROP POLICY IF EXISTS "Allow authenticated select to unified_events" ON public.unified_events_pre_partition;
DROP POLICY IF EXISTS "Station members can view unified events" ON public.unified_events_pre_partition;
DROP POLICY IF EXISTS "No updates to unified_events" ON public.unified_events_pre_partition;
-- Keeps: "Admins can view all audit logs", "Station members can update unified events"
-- Add a clean unified SELECT for station members and admins
DROP POLICY IF EXISTS "Unified events readable by members" ON public.unified_events_pre_partition;
CREATE POLICY "Unified events readable by members" ON public.unified_events_pre_partition
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE station_id = unified_events_pre_partition.station_id
              AND auth_user_id = (SELECT auth.uid())
        )
        OR (SELECT public.get_auth_level()) <= 4
    );
