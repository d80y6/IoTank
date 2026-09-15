-- supabase/migrations/20260601000005_linter_compliance_audit.sql
-- ============================================================================
-- 1. Performance: auth_rls_initplan Optimization
-- ============================================================================
-- Wrapping auth calls in (SELECT ...) to prevent per-row re-evaluation.

-- Profiles
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles self-visibility" ON public.profiles;
DROP POLICY IF EXISTS "Admin full access" ON public.profiles;
DROP POLICY IF EXISTS "Consolidated profiles SELECT" ON public.profiles;
CREATE POLICY "Consolidated profiles SELECT" ON public.profiles
FOR SELECT TO authenticated
USING (
    auth_user_id = (SELECT auth.uid()) 
    OR (SELECT public.check_is_staff())
);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles self-update" ON public.profiles;
DROP POLICY IF EXISTS "Consolidated profiles UPDATE" ON public.profiles;
CREATE POLICY "Consolidated profiles UPDATE" ON public.profiles
FOR UPDATE TO authenticated
USING (auth_user_id = (SELECT auth.uid()) OR (SELECT public.check_is_staff()))
WITH CHECK (auth_user_id = (SELECT auth.uid()) OR (SELECT public.check_is_staff()));

-- Tanks
DROP POLICY IF EXISTS "Users can view own tanks" ON public.tanks;
DROP POLICY IF EXISTS "Tenant isolation" ON public.tanks;
DROP POLICY IF EXISTS "Admin full access" ON public.tanks;
DROP POLICY IF EXISTS "Consolidated tanks access" ON public.tanks;
CREATE POLICY "Consolidated tanks access" ON public.tanks
FOR ALL TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
)
WITH CHECK (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- Alerts
DROP POLICY IF EXISTS "Users can view alerts for their station" ON public.alerts;
DROP POLICY IF EXISTS "Users can manage alerts for their station" ON public.alerts;
DROP POLICY IF EXISTS "Admin full access" ON public.alerts;
DROP POLICY IF EXISTS "System can insert alerts" ON public.alerts;
DROP POLICY IF EXISTS "Users can update own station alerts" ON public.alerts;
DROP POLICY IF EXISTS "Consolidated alerts access" ON public.alerts;
CREATE POLICY "Consolidated alerts access" ON public.alerts
FOR ALL TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
)
WITH CHECK (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- ============================================================================
-- 2. Performance: Unindexed Foreign Keys
-- ============================================================================
-- Ensuring all foreign keys have covering indexes to improve JOIN performance.
-- Using DO blocks for tables whose column may still be named 'supabase_uid'
-- (FK constraint names like alerts_supabase_uid_fkey confirm this reality).

DO $$ BEGIN
    -- alerts: FK column may be supabase_uid or auth_user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alerts' AND column_name = 'auth_user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alerts_auth_user_id') THEN
            EXECUTE 'CREATE INDEX idx_alerts_auth_user_id ON public.alerts (auth_user_id)';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alerts' AND column_name = 'supabase_uid') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alerts_supabase_uid') THEN
            EXECUTE 'CREATE INDEX idx_alerts_supabase_uid ON public.alerts (supabase_uid)';
        END IF;
    END IF;

    -- deliveries: FK column may be supabase_uid or auth_user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deliveries' AND column_name = 'auth_user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_deliveries_auth_user_id') THEN
            EXECUTE 'CREATE INDEX idx_deliveries_auth_user_id ON public.deliveries (auth_user_id)';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deliveries' AND column_name = 'supabase_uid') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_deliveries_supabase_uid') THEN
            EXECUTE 'CREATE INDEX idx_deliveries_supabase_uid ON public.deliveries (supabase_uid)';
        END IF;
    END IF;

    -- shift_closures: FK column may be supabase_uid or auth_user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_closures' AND column_name = 'auth_user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_shift_closures_auth_user_id') THEN
            EXECUTE 'CREATE INDEX idx_shift_closures_auth_user_id ON public.shift_closures (auth_user_id)';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_closures' AND column_name = 'supabase_uid') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_shift_closures_supabase_uid') THEN
            EXECUTE 'CREATE INDEX idx_shift_closures_supabase_uid ON public.shift_closures (supabase_uid)';
        END IF;
    END IF;

    -- tanks: FK column may be supabase_uid or auth_user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tanks' AND column_name = 'auth_user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tanks_auth_user_id') THEN
            EXECUTE 'CREATE INDEX idx_tanks_auth_user_id ON public.tanks (auth_user_id)';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tanks' AND column_name = 'supabase_uid') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tanks_supabase_uid') THEN
            EXECUTE 'CREATE INDEX idx_tanks_supabase_uid ON public.tanks (supabase_uid)';
        END IF;
    END IF;

    -- transactions: FK column may be supabase_uid or auth_user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'auth_user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_transactions_auth_user_id') THEN
            EXECUTE 'CREATE INDEX idx_transactions_auth_user_id ON public.transactions (auth_user_id)';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'supabase_uid') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_transactions_supabase_uid') THEN
            EXECUTE 'CREATE INDEX idx_transactions_supabase_uid ON public.transactions (supabase_uid)';
        END IF;
    END IF;

    -- profiles: FK column should be auth_user_id but check to be safe
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'auth_user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_profiles_auth_user_id') THEN
            EXECUTE 'CREATE INDEX idx_profiles_auth_user_id ON public.profiles (auth_user_id)';
        END IF;
    END IF;

    -- sensor_readings_legacy: FK column may be supabase_uid or auth_user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sensor_readings_legacy' AND column_name = 'auth_user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sensor_readings_legacy_auth_user_id') THEN
            EXECUTE 'CREATE INDEX idx_sensor_readings_legacy_auth_user_id ON public.sensor_readings_legacy (auth_user_id)';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sensor_readings_legacy' AND column_name = 'supabase_uid') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sensor_readings_legacy_supabase_uid') THEN
            EXECUTE 'CREATE INDEX idx_sensor_readings_legacy_supabase_uid ON public.sensor_readings_legacy (supabase_uid)';
        END IF;
    END IF;

    -- sites: FK column may be supabase_uid or auth_user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sites' AND column_name = 'auth_user_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sites_auth_user_id') THEN
            EXECUTE 'CREATE INDEX idx_sites_auth_user_id ON public.sites (auth_user_id)';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sites' AND column_name = 'supabase_uid') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sites_supabase_uid') THEN
            EXECUTE 'CREATE INDEX idx_sites_supabase_uid ON public.sites (supabase_uid)';
        END IF;
    END IF;
END $$;

-- Safe static indexes (column names confirmed from schema):
CREATE INDEX IF NOT EXISTS idx_analysis_history_file_id           ON public.analysis_history (file_id);
CREATE INDEX IF NOT EXISTS idx_auth_events_user_id                ON public.auth_events (user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_tank_id              ON public.device_tokens (tank_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_issued_by            ON public.device_tokens (issued_by);
CREATE INDEX IF NOT EXISTS idx_device_tokens_revoked_by           ON public.device_tokens (revoked_by);
CREATE INDEX IF NOT EXISTS idx_deliveries_tank_id                 ON public.deliveries (tank_id);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_station_id       ON public.fuel_transactions (station_id);
CREATE INDEX IF NOT EXISTS idx_shift_closures_site_id             ON public.shift_closures (site_id);
CREATE INDEX IF NOT EXISTS idx_tanks_site_id                      ON public.tanks (site_id);
CREATE INDEX IF NOT EXISTS idx_unified_events_pre_partition_actor ON public.unified_events_pre_partition (actor_id);


-- ============================================================================
-- 3. Cleanup: Consolidate Multiple Permissive Policies (Extended)
-- ============================================================================

-- Security Telemetry Events: Consolidate anon/auth INSERT
DROP POLICY IF EXISTS "Public can insert security telemetry" ON public.security_telemetry_events;
DROP POLICY IF EXISTS "Users can insert telemetry" ON public.security_telemetry_events;
DROP POLICY IF EXISTS "Consolidated security_telemetry_events INSERT" ON public.security_telemetry_events;
CREATE POLICY "Consolidated security_telemetry_events INSERT" 
ON public.security_telemetry_events FOR INSERT TO public WITH CHECK (true);

-- Auth Attempts: Consolidate SELECT
DROP POLICY IF EXISTS "Public can read own auth attempts" ON public.auth_attempts;
DROP POLICY IF EXISTS "System admins can view auth attempts" ON public.auth_attempts;
DROP POLICY IF EXISTS "Consolidated auth_attempts SELECT" ON public.auth_attempts;
CREATE POLICY "Consolidated auth_attempts SELECT"
ON public.auth_attempts FOR SELECT TO authenticated
USING (email IS NOT NULL OR (SELECT public.check_is_staff()));

-- Deliveries: Consolidate ALL
DROP POLICY IF EXISTS "Tenant isolation" ON public.deliveries;
DROP POLICY IF EXISTS "Users can manage deliveries for their station" ON public.deliveries;
DROP POLICY IF EXISTS "Admin full access" ON public.deliveries;
DROP POLICY IF EXISTS "Consolidated deliveries access" ON public.deliveries;
CREATE POLICY "Consolidated deliveries access"
ON public.deliveries FOR ALL TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- Fuel Stations: Consolidate ALL
DROP POLICY IF EXISTS "Consolidated fuel_stations management" ON public.fuel_stations;
DROP POLICY IF EXISTS "Admin full access" ON public.fuel_stations;
DROP POLICY IF EXISTS "Service role full access to billing" ON public.fuel_stations;
DROP POLICY IF EXISTS "Station visibility" ON public.fuel_stations;
DROP POLICY IF EXISTS "Consolidated fuel_stations management" ON public.fuel_stations;
CREATE POLICY "Consolidated fuel_stations management"
ON public.fuel_stations FOR ALL TO authenticated
USING (
    owner_id = (SELECT auth.uid()) 
    OR (SELECT public.check_is_staff())
);

-- Shift Closures: Consolidate
DROP POLICY IF EXISTS "Users can manage shifts in their station" ON public.shift_closures;
DROP POLICY IF EXISTS "Admin full access" ON public.shift_closures;
DROP POLICY IF EXISTS "Consolidated shift_closures access" ON public.shift_closures;
CREATE POLICY "Consolidated shift_closures access"
ON public.shift_closures FOR ALL TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- Sites: Consolidate
DROP POLICY IF EXISTS "Users can view own sites" ON public.sites;
DROP POLICY IF EXISTS "Users can update own sites" ON public.sites;
DROP POLICY IF EXISTS "System admins can manage sites" ON public.sites;
DROP POLICY IF EXISTS "Admin full access" ON public.sites;
DROP POLICY IF EXISTS "Consolidated sites access" ON public.sites;
CREATE POLICY "Consolidated sites access"
ON public.sites FOR ALL TO authenticated
USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))
    OR (SELECT public.check_is_staff())
);

-- ============================================================================
-- 4. Cleanup: Unused Index Removal
-- ============================================================================
-- Dropping indexes identified as unused by the linter to reduce write overhead.

DROP INDEX IF EXISTS public.idx_ai_recs_date;
DROP INDEX IF EXISTS public.idx_scraper_last_at;
DROP INDEX IF EXISTS public.idx_tank_analytics_station;
DROP INDEX IF EXISTS public.idx_edge_rate_limits_lookup;

NOTIFY pgrst, 'reload schema';
