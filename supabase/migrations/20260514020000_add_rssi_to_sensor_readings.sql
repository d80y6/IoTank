-- supabase/migrations/20260514020000_add_rssi_to_sensor_readings.sql
-- ============================================================================
-- FIX: Add missing 'rssi' column to sensor_readings for hardware compatibility.
-- ============================================================================

DO $$ 
BEGIN
    -- Add rssi column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sensor_readings' AND column_name = 'rssi') THEN
        ALTER TABLE public.sensor_readings ADD COLUMN rssi INTEGER;
    END IF;

    -- Add signal_strength column if it doesn't exist (hardware might use either)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sensor_readings' AND column_name = 'signal_strength') THEN
        ALTER TABLE public.sensor_readings ADD COLUMN signal_strength INTEGER;
    END IF;
END $$;

-- Update the latest_sensor_readings view if it exists to include the new columns
DROP VIEW IF EXISTS public.latest_sensor_readings;
CREATE VIEW public.latest_sensor_readings AS
SELECT DISTINCT ON (tank_id)
    id,
    station_id,
    tank_id,
    volume,
    volume_corrected,
    temperature,
    captured_at,
    metadata,
    rssi,
    signal_strength
FROM public.sensor_readings
ORDER BY tank_id, captured_at DESC;
