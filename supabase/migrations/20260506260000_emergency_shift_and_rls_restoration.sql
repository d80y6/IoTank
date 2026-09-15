-- supabase/migrations/20260506260000_emergency_shift_and_rls_restoration.sql
-- ============================================================================
-- EMERGENCY RESTORATION: Shift Management & RLS Integrity
-- ============================================================================

-- 1. RESTORE SHIFT ACTIVATION (INSERT/UPDATE)
-- ============================================================================
DROP POLICY IF EXISTS "Station members can manage shift status" ON public.current_station_shifts;
CREATE POLICY "Station members can manage shift status"
    ON public.current_station_shifts
    FOR ALL
    TO authenticated
    USING (station_id = (SELECT get_station_id_from_auth()))
    WITH CHECK (station_id = (SELECT get_station_id_from_auth()));

-- Ensure closures are also manageable
DROP POLICY IF EXISTS "Users can manage shifts in their station" ON public.shift_closures;
CREATE POLICY "Users can manage shifts in their station"
    ON public.shift_closures
    FOR ALL
    TO authenticated
    USING (station_id = (SELECT get_station_id_from_auth()))
    WITH CHECK (station_id = (SELECT get_station_id_from_auth()));

-- 2. FIX FUEL_STATIONS ID REFERENCES
-- Earlier today, 'id' was renamed to 'station_id'. We must ensure all functions agree.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_user_bundle_v2()
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  WITH identity AS (
    SELECT
      'profile'::TEXT         AS identity_type,
      p.role,
      p.display_name,
      p.photo_url,
      p.station_id,
      COALESCE(fs.station_name, 'Organization Setup Pending') AS station_name,
      fs.logo_url,
      fs.county,
      p.address,
      p.phone_number,
      p.site_ids,
      COALESCE(p.mfa_enabled, FALSE) AS mfa_enabled,
      TRUE                    AS is_active,
      p.created_at,
      p.email,
      CASE p.role
        WHEN 'admin'      THEN 5
        WHEN 'owner'      THEN 5
        WHEN 'supervisor' THEN 6
        WHEN 'operator'   THEN 7
        WHEN 'viewer'     THEN 8
        ELSE 99
      END                     AS auth_level
    FROM public.profiles p
    -- FIX: Use station_id instead of id
    LEFT JOIN public.fuel_stations fs ON p.station_id = fs.station_id
    WHERE p.auth_user_id = v_uid
    LIMIT 1
  )
  SELECT to_jsonb(identity.*) INTO v_result FROM identity;

  RETURN v_result;
END;
$$;

-- 3. RESTORE MISSING INSERT PERMISSIONS ON OTHER TABLES
-- ============================================================================

-- Alerts (System needs to insert, but users should be able to acknowledge/update)
DROP POLICY IF EXISTS "Users can manage alerts for their station" ON public.alerts;
CREATE POLICY "Users can manage alerts for their station"
    ON public.alerts
    FOR ALL
    TO authenticated
    USING (station_id = (SELECT get_station_id_from_auth()))
    WITH CHECK (station_id = (SELECT get_station_id_from_auth()));

-- Deliveries
DROP POLICY IF EXISTS "Users can manage deliveries for their station" ON public.deliveries;
CREATE POLICY "Users can manage deliveries for their station"
    ON public.deliveries
    FOR ALL
    TO authenticated
    USING (station_id = (SELECT get_station_id_from_auth()))
    WITH CHECK (station_id = (SELECT get_station_id_from_auth()));

-- Sensor Readings (Devices usually insert, but station context is key)
-- (Existing policies might be sufficient, but we ensure station members can at least view)
DROP POLICY IF EXISTS "Station members can view sensor readings" ON public.sensor_readings;
CREATE POLICY "Station members can view sensor readings"
    ON public.sensor_readings
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM tanks WHERE tanks.id = sensor_readings.tank_id AND tanks.station_id = (SELECT get_station_id_from_auth())));

NOTIFY pgrst, 'reload schema';
