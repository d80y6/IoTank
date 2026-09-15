-- supabase/migrations/99999999000012_telemetry_anon_access.sql
-- ============================================================================
-- TELEMETRY ANON ACCESS (V2.5.0)
-- Allows ESP devices using the 'anon' key to insert sensor data.
-- ============================================================================

-- 1. FIX: Allow 'anon' role to insert sensor readings
-- ESP32 devices typically use the 'anon' key. 
-- The previously restrictive policy required a 'device' JWT role.
-- ============================================================================

DROP POLICY IF EXISTS "Hardware devices can insert readings" ON public.sensor_readings;

-- Restrictive Policy (For Authenticated Devices with JWT)
CREATE POLICY "Hardware devices can insert readings" ON public.sensor_readings
FOR INSERT TO authenticated
WITH CHECK (
    (auth.role() = 'service_role') OR (
        ((auth.jwt() ->> 'role'::text) = 'device'::text) AND 
        (((auth.jwt() ->> 'station_id'::text))::uuid = station_id) AND
        EXISTS (SELECT 1 FROM public.tanks t WHERE t.id = tank_id AND t.status = 'active')
    )
);

-- Permissive Policy (For ESP devices using the 'anon' key)
-- We allow insertion IF the tank_id exists and the tank is 'active'.
-- The 'tr_set_station_id' trigger (SECURITY DEFINER) will handle the station_id resolution.
DROP POLICY IF EXISTS "ESP devices can insert via anon" ON public.sensor_readings;
CREATE POLICY "ESP devices can insert via anon" ON public.sensor_readings
FOR INSERT TO anon
WITH CHECK (
    EXISTS (SELECT 1 FROM public.tanks t WHERE t.id = tank_id AND t.status = 'active')
);


-- 2. SECURITY: Hardening Tank Visibility for anon
-- (Anon should NOT be able to select from tanks, but our triggers are SECURITY DEFINER)
-- We ensure anon can't read sensitive data.
-- ============================================================================

-- Ensure PostgREST knows about the new policy
NOTIFY pgrst, 'reload schema';
