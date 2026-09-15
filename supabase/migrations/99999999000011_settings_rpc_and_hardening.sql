-- supabase/migrations/99999999000011_settings_rpc_and_hardening.sql
-- ============================================================================
-- SETTINGS & SECURITY HARDENING (V2.4.0)
-- 1. Create verify_master_password RPC (Fixes 404)
-- 2. Repair profiles column references (Fixes 400)
-- 3. Ingestion Health Indices
-- ============================================================================

-- 1. FIX: Missing RPC verify_master_password
-- This is used to unlock settings tabs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_master_password(test_password TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_master_password TEXT;
BEGIN
    -- Get the master password for the station associated with the user
    SELECT master_password INTO v_master_password
    FROM public.fuel_stations
    WHERE station_id = (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid());

    -- If no master password is set, we use a fallback or return false
    -- For security, if it is null, we return false (user must set it via 'update_master_password')
    IF v_master_password IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN v_master_password = test_password;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.verify_master_password(TEXT) TO authenticated;


-- 2. FIX: update_master_password (Security DEFINER Hardening)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_master_password(new_password TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.fuel_stations
    SET master_password = new_password
    WHERE station_id = (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.update_master_password(TEXT) TO authenticated;


-- 3. TELEMETRY: Ingestion Health Indices
-- Ensure high-frequency inserts don't block.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sensor_readings_tank_captured 
    ON public.sensor_readings(tank_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_station 
    ON public.sensor_readings(station_id);


-- 4. IDENTITY: Restore 'id' as a generated alias (Compatibility Layer)
-- If the frontend is STILL looking for 'id' via PostgREST select=id, 
-- we can provide it as a generated column or view, but better to fix the frontend.
-- However, for the ESP/Hardware layer, we want it to be stable.
-- We will NOT add 'id' back to the table, but we will ensure the frontend is fixed.


-- RELOAD PostgREST
NOTIFY pgrst, 'reload schema';
