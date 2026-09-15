-- supabase/migrations/20260508000002_harden_alerts_integrity.sql
-- ============================================================================
-- FORENSIC INTEGRITY: Alerts Hardening & Idempotency
-- ============================================================================
-- 1. Adding a unique index to support ON CONFLICT upserts in the Alert Engine.
--    This prevents duplicate active alerts of the same type for the same tank.
-- 2. Implementing a tamper-proof trigger to ensure historical data remains 
--    immutable, allowing only resolution and acknowledgement updates.

-- ── 1. IDEMPOTENCY INDEX ──────────────────────────────────────────────────
-- We use a partial index to only deduplicate ACTIVE alerts. 
-- This allows history (resolved alerts) to accumulate while keeping current 
-- operational state clean and conflict-free.
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'alerts' 
        AND indexname = 'idx_alerts_active_dedupe'
    ) THEN
        CREATE UNIQUE INDEX idx_alerts_active_dedupe 
        ON public.alerts (station_id, tank_id, alert_type) 
        WHERE (is_resolved = false);
    END IF;
END $$;

-- ── 2. FORENSIC INTEGRITY TRIGGER ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_alert_tampering()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow updating ONLY specific state/governance columns
    IF (TG_OP = 'UPDATE') THEN
        IF (OLD.id = NEW.id AND 
            OLD.station_id = NEW.station_id AND
            OLD.tank_id = NEW.tank_id AND
            OLD.alert_type = NEW.alert_type AND
            OLD.severity = NEW.severity AND
            OLD.title = NEW.title AND
            OLD.message = NEW.message AND
            OLD.created_at = NEW.created_at) THEN
            
            -- Only state/meta columns changed (is_resolved, is_read, acknowledged_*, etc)
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Forensic Integrity Violation: Alert history is immutable. Only status, resolution, and acknowledgement fields can be modified.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_prevent_alert_tampering ON public.alerts;
CREATE TRIGGER tr_prevent_alert_tampering
    BEFORE UPDATE ON public.alerts
    FOR EACH ROW
    EXECUTE PROCEDURE public.prevent_alert_tampering();

-- ── 3. RLS POLICY HARMONIZATION ───────────────────────────────────────────
-- Ensure authenticated users can update (resolve/read) alerts for their station.
DROP POLICY IF EXISTS "Users can update own station alerts" ON public.alerts;
CREATE POLICY "Users can update own station alerts"
    ON public.alerts
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE station_id = alerts.station_id 
            AND auth_user_id = auth.uid()
        ) OR 
        public.get_auth_level() <= 4
    )
    WITH CHECK (
        -- Integrity enforced by 'prevent_alert_tampering' trigger
        TRUE
    );

-- ── 4. VERIFICATION HELPERS ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_index_exists(p_index_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = p_index_name
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
