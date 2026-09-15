-- supabase/migrations/20260514150000_relax_alert_tampering_for_active_alerts.sql
-- ============================================================================
-- REPAIR: Allow "Pulse Updates" for Active (Unresolved) Alerts
-- ============================================================================
-- The previous 'prevent_alert_tampering' trigger was too strict, blocking
-- the 'upsert_alert_v2' function from updating severity or messages even
-- for active alerts. 
--
-- Forensic Rule:
-- 1. Active alerts can be updated (Escalations, message refinement).
-- 2. Resolved/Acknowledged alerts are IMMUTABLE (Historical integrity).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_alert_tampering()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        -- Rule A: If the alert was ALREADY resolved, absolutely NO changes allowed (except perhaps metadata)
        IF (OLD.is_resolved = true AND NEW.is_resolved = true) THEN
             IF (OLD.id IS NOT DISTINCT FROM NEW.id AND 
                OLD.station_id IS NOT DISTINCT FROM NEW.station_id AND
                OLD.tank_id IS NOT DISTINCT FROM NEW.tank_id AND
                OLD.alert_type IS NOT DISTINCT FROM NEW.alert_type AND
                OLD.severity IS NOT DISTINCT FROM NEW.severity AND
                OLD.title IS NOT DISTINCT FROM NEW.title AND
                OLD.message IS NOT DISTINCT FROM NEW.message AND
                OLD.created_at IS NOT DISTINCT FROM NEW.created_at) THEN
                RETURN NEW;
             END IF;
             RAISE EXCEPTION 'Forensic Integrity Violation: Resolved alert history is immutable and cannot be modified.';
        END IF;

        -- Rule B: If the alert is ACTIVE, we allow updates to severity, title, and message
        -- (This supports the 'upsert_alert_v2' pulse-update logic)
        -- But we still block tampering with core identity (id, station, tank, type, created_at)
        IF (OLD.id IS NOT DISTINCT FROM NEW.id AND 
            OLD.station_id IS NOT DISTINCT FROM NEW.station_id AND
            OLD.tank_id IS NOT DISTINCT FROM NEW.tank_id AND
            OLD.alert_type IS NOT DISTINCT FROM NEW.alert_type AND
            OLD.created_at IS NOT DISTINCT FROM NEW.created_at) THEN
            
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Forensic Integrity Violation: Alert identity (Station, Tank, Type, Timestamp) is immutable.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Reload schema to ensure PostgREST picks up the logic change
NOTIFY pgrst, 'reload schema';
