-- supabase/migrations/99999999000010_telemetry_hard_stability.sql
-- ============================================================================
-- TELEMETRY & IDENTITY HARD STABILITY (V2.3.0)
-- 1. Auto-fill station_id for Sensor Readings (Fixes ESP Ingestion Latency)
-- 2. Robust Identity Handshake (Profiles <-> user_preferences)
-- ============================================================================

-- STEP 1: Telemetry Ingestion Auto-Fill
-- Devices (ESPs) often don't know their station_id, only their tank_id.
-- We must auto-resolve station_id BEFORE the RLS check to prevent rejections.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_sensor_reading_station_id()
RETURNS TRIGGER AS $$
BEGIN
    -- If station_id is missing, look it up from the tank record
    IF NEW.station_id IS NULL THEN
        SELECT station_id INTO NEW.station_id 
        FROM public.tanks 
        WHERE id = NEW.tank_id;
    END IF;
    
    -- Safety: If tank_id was invalid or tank has no station, we must block
    IF NEW.station_id IS NULL THEN
        RAISE EXCEPTION 'Ingestion Failed: tank_id % is not associated with any station.', NEW.tank_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_set_station_id ON public.sensor_readings;
CREATE TRIGGER tr_set_station_id
    BEFORE INSERT ON public.sensor_readings
    FOR EACH ROW EXECUTE FUNCTION public.set_sensor_reading_station_id();


-- STEP 2: Optimize update_tank_from_sensor
-- Ensure high-frequency updates don't deadlock or lag.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_tank_from_sensor()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.tanks
    SET 
        current_volume = NEW.volume,
        last_reading_at = NEW.captured_at, -- Use the actual telemetry timestamp
        last_rssi = NEW.rssi,
        updated_at = NOW()
    WHERE id = NEW.tank_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- STEP 3: Ensure User Profile Existence (Fixes FK Violation)
-- This ensures that any authenticated user has at least a minimal profile
-- so that user_preferences (which references profiles) doesn't crash.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_user_profile_exists()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (auth_user_id, email, display_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        'viewer'
    )
    ON CONFLICT (auth_user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-apply the trigger to auth.users if possible (requires superuser or via dashboard)
-- Note: In managed Supabase, we usually use the handle_new_user trigger.
-- We will strengthen handle_new_user instead.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (auth_user_id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'viewer'
  )
  ON CONFLICT (auth_user_id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;


-- STEP 4: user_preferences RLS - Final Hardening
-- ============================================================================
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own preferences" ON public.user_preferences;
CREATE POLICY "Users manage own preferences" ON public.user_preferences
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- RELOAD PostgREST
NOTIFY pgrst, 'reload schema';
