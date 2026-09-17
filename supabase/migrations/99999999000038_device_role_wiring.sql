-- 99999999000038_device_role_wiring.sql
-- Hardware JWT (role: 'device') could never authenticate: issue-device-token
-- signs a token whose `role` claim is `device`, but no such Postgres role existed,
-- so PostgREST aborted every device request ("role device does not exist").
-- This migration creates the role, grants the minimum surface the ESP32 firmware
-- needs, and adds the missing RLS policies so a device JWT can:
--   * read its own pending commands          (device_commands SELECT)
--   * acknowledge its commands               (device_commands UPDATE - policy exists)
--   * push readings / telemetry              (sensor_readings, telemetry_history INSERT - policies exist)
--   * fetch dip->volume calibration tables   (tanks / volume_lookup_tables SELECT)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'device') THEN
    CREATE ROLE device NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO device;

-- PostgREST connects as `authenticator` and performs SET ROLE to the JWT role;
-- without this membership it rejects the device JWT with
-- "permission denied to set role \"device\"".
GRANT device TO authenticator;

GRANT SELECT, UPDATE ON public.device_commands TO device;
GRANT INSERT ON public.sensor_readings TO device;
GRANT INSERT ON public.telemetry_history TO device;
GRANT SELECT ON public.tanks TO device;
GRANT SELECT ON public.volume_lookup_tables TO device;

-- The pre-existing command policies are PUBLIC-scoped and reference `profiles`
-- in their USING/WITH CHECK. When evaluated for the `device` role that subselect
-- raises "permission denied for table profiles". Users are `authenticated`, so
-- scope those policies to authenticated and let the device policy below serve devices.
ALTER POLICY "Users can view their station commands" ON public.device_commands TO authenticated;
ALTER POLICY "Users can insert station commands" ON public.device_commands TO authenticated;

-- Device may read only the commands targeted at its own station.
DROP POLICY IF EXISTS "Devices can view their station commands" ON public.device_commands;
CREATE POLICY "Devices can view their station commands"
  ON public.device_commands
  FOR SELECT
  TO device
  USING (
    (auth.jwt() ->> 'role') = 'device'
    AND (auth.jwt() ->> 'station_id')::uuid = station_id
  );

-- Device may read its own tank row(s) for calibration parameters.
DROP POLICY IF EXISTS "Devices can read their tanks" ON public.tanks;
CREATE POLICY "Devices can read their tanks"
  ON public.tanks
  FOR SELECT
  TO device
  USING (
    (auth.jwt() ->> 'role') = 'device'
    AND (auth.jwt() ->> 'station_id')::uuid = station_id
  );

-- Dip/volume lookup is a global reference table (no station dimension).
DROP POLICY IF EXISTS "Devices can read volume lookup tables" ON public.volume_lookup_tables;
CREATE POLICY "Devices can read volume lookup tables"
  ON public.volume_lookup_tables
  FOR SELECT
  TO device
  USING (true);
