-- 99999999000036_bridge_firmware_telemetry_and_critical_alerts.sql
-- Reconnects the live telemetry path (partitioned sensor_readings) to the apps, exposes
-- public wrappers for the internal-schema critical-alert lifecycle used by the
-- dispatch-critical-alerts Edge Function, stamps device_commands.processed_at, and adds
-- the event-sourcing triggers the partitioned table was missing.

-- =====================================================================================
-- 1) Public API wrappers for the critical-alert lifecycle (internal schema is not exposed
--    by PostgREST; the Edge Function runs as service_role against /rest/v1/rpc/*)
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.claim_pending_critical_alert_events(p_limit integer DEFAULT 20)
RETURNS SETOF public.security_telemetry_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY SELECT * FROM internal.claim_pending_critical_alert_events(p_limit);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_pending_critical_alert_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_critical_alert_events(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_critical_alert_event(p_event_id uuid, p_sent boolean, p_error text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM internal.complete_critical_alert_event(p_event_id, p_sent, p_error);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_critical_alert_event(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_critical_alert_event(uuid, boolean, text) TO service_role;

-- =====================================================================================
-- 2) latest_sensor_readings now sources from the live partitioned telemetry table.
--    Output columns are a superset of the old legacy-backed view; rssi rides in metadata.
-- =====================================================================================

-- Column types changed (volume numeric -> double precision, timestamps gain TZ), so the
-- view must be dropped and recreated rather than replaced in place.
DROP VIEW IF EXISTS public.latest_sensor_readings;
CREATE VIEW public.latest_sensor_readings AS
SELECT DISTINCT ON (tank_id)
    id,
    station_id,
    tank_id,
    volume,
    volume_corrected,
    temperature,
    water_level,
    captured_at,
    captured_at AS "timestamp",
    (CASE WHEN metadata ->> 'rssi' ~ '^[0-9-]+$' THEN NULLIF(metadata ->> 'rssi', '')::integer END) AS rssi,
    metadata
FROM public.sensor_readings
ORDER BY tank_id, captured_at DESC;

GRANT SELECT ON public.latest_sensor_readings TO anon, authenticated, service_role;

-- =====================================================================================
-- 3) Tank-state updater adapted to the partitioned schema (no top-level rssi column;
--    RSSI arrives inside metadata). Mirrors internal.update_tank_state.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.update_tank_from_reading()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    -- Row lock prevents races during concurrent telemetry bursts
    PERFORM 1 FROM public.tanks WHERE id = NEW.tank_id FOR UPDATE;

    UPDATE public.tanks
    SET current_volume = NEW.volume,
        current_temperature = NEW.temperature,
        last_reading_at = NEW.captured_at,
        updated_at = NOW()
    WHERE id = NEW.tank_id;

    RETURN NEW;
END;
$function$;

-- =====================================================================================
-- 4) Port the integrity/state triggers that previously only existed on
--    sensor_readings_legacy onto the partitioned parent (auto-propagates to partitions).
--    handle_data_smoothing is intentionally NOT ported: it forwards to a hardcoded
--    production URL and its payload contract is legacy-shaped.
-- =====================================================================================

DROP TRIGGER IF EXISTS trigger_validate_reading_station ON public.sensor_readings;
CREATE TRIGGER trigger_validate_reading_station
BEFORE INSERT ON public.sensor_readings
FOR EACH ROW EXECUTE FUNCTION public.validate_reading_station_match();

DROP TRIGGER IF EXISTS trigger_validate_sensor_reading ON public.sensor_readings;
CREATE TRIGGER trigger_validate_sensor_reading
BEFORE INSERT OR UPDATE ON public.sensor_readings
FOR EACH ROW EXECUTE FUNCTION internal.validate_sensor_reading();

DROP TRIGGER IF EXISTS trigger_update_tank_state ON public.sensor_readings;
CREATE TRIGGER trigger_update_tank_state
AFTER INSERT ON public.sensor_readings
FOR EACH ROW EXECUTE FUNCTION public.update_tank_from_reading();

-- =====================================================================================
-- 5) Stamp processed_at when a firmware device acknowledges a command.
--    Firmware only PATCHes status (+ optional error_message); the DB fixes the clock.
-- =====================================================================================

CREATE OR REPLACE FUNCTION internal.stamp_device_command_processed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.processed_at IS NULL THEN
        NEW.processed_at = NOW();
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_stamp_device_command_processed_at ON public.device_commands;
CREATE TRIGGER trigger_stamp_device_command_processed_at
BEFORE UPDATE ON public.device_commands
FOR EACH ROW
WHEN (NEW.status IN ('processed', 'failed') AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION internal.stamp_device_command_processed_at();