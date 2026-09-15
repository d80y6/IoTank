-- supabase/migrations/20260514080000_repair_telemetry_ingestion.sql
-- ============================================================================
-- REPAIR: Restore Telemetry Ingestion (Schema, RLS, Triggers)
-- ============================================================================
-- Resolves the "12-day telemetry gap" caused by the partitioning swap.

-- 1. ADD MISSING COLUMNS
-- Ensure 'rssi' exists on the parent table.
-- Note: In Postgres, adding a column to a partitioned parent automatically 
-- propagates it to all current and future partitions.
ALTER TABLE public.sensor_readings ADD COLUMN IF NOT EXISTS rssi INTEGER;

-- 2. RESTORE TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.update_tank_from_sensor()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.tanks
    SET 
        current_volume = NEW.volume,
        last_reading_at = NEW.timestamp,
        last_rssi = NEW.rssi,
        updated_at = NOW()
    WHERE id = NEW.tank_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. RESTORE TRIGGER
-- Re-apply the trigger to the parent table. 
-- In Postgres 11+, triggers on the parent are automatically inherited by partitions.
DROP TRIGGER IF EXISTS update_tank_state ON public.sensor_readings;
CREATE TRIGGER update_tank_state 
AFTER INSERT ON public.sensor_readings 
FOR EACH ROW EXECUTE FUNCTION public.update_tank_from_sensor();

-- 3. RESTORE RLS POLICIES
-- The partitioned table swap lost the granular policies.
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;

-- Hardware Ingestion (Device JWT)
DROP POLICY IF EXISTS "Hardware devices can insert readings" ON public.sensor_readings;
CREATE POLICY "Hardware devices can insert readings" ON public.sensor_readings
FOR INSERT WITH CHECK (
    (auth.role() = 'service_role') OR (
        ((auth.jwt() ->> 'role') = 'device') AND 
        (((auth.jwt() ->> 'station_id'))::uuid = station_id)
    )
);

-- Member View (Station Access)
DROP POLICY IF EXISTS "Users can view own sensor readings" ON public.sensor_readings;
CREATE POLICY "Users can view own sensor readings" ON public.sensor_readings
FOR SELECT TO authenticated USING (
    station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid())
    OR (SELECT public.check_is_staff())
);

-- 4. RELOAD SCHEMA
NOTIFY pgrst, 'reload schema';
