-- supabase/migrations/20260514040000_repair_alerts_forensic_trigger.sql
-- ============================================================================
-- REPAIR: Forensic Integrity Trigger NULL Handling
-- ============================================================================
-- The previous implementation of 'prevent_alert_tampering' used '=' which 
-- fails on NULL values (e.g., alerts without a tank_id). 
-- This migration switches to 'IS NOT DISTINCT FROM' for robust comparison.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_alert_tampering()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow updating ONLY specific state/governance columns
    IF (TG_OP = 'UPDATE') THEN
        IF (OLD.id IS NOT DISTINCT FROM NEW.id AND 
            OLD.station_id IS NOT DISTINCT FROM NEW.station_id AND
            OLD.tank_id IS NOT DISTINCT FROM NEW.tank_id AND
            OLD.alert_type IS NOT DISTINCT FROM NEW.alert_type AND
            OLD.severity IS NOT DISTINCT FROM NEW.severity AND
            OLD.title IS NOT DISTINCT FROM NEW.title AND
            OLD.message IS NOT DISTINCT FROM NEW.message AND
            OLD.created_at IS NOT DISTINCT FROM NEW.created_at) THEN
            
            -- Only state/meta columns changed (is_resolved, is_read, acknowledged_*, etc)
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Forensic Integrity Violation: Alert history is immutable. Only status, resolution, and acknowledgement fields can be modified.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists, so the OR REPLACE above handles the logic change.
-- Ensure PostgREST is aware of the change.
NOTIFY pgrst, 'reload schema';
