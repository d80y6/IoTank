-- supabase/migrations/20260515183000_fix_pin_persistence.sql
-- ============================================================================
-- FIX: PIN Persistence in Identity Bundle
-- ============================================================================

-- Update get_user_bundle_v2 to include security_pin_enabled from profiles.
-- This ensures that upon page refresh, the UI correctly identifies if a PIN
-- has been configured.

CREATE OR REPLACE FUNCTION public.get_user_bundle_v2()
RETURNS JSONB AS $$
DECLARE v_bundle JSONB;
BEGIN
  WITH identity_set AS (
    -- System Governance Users (Super Admins, etc.)
    SELECT
      'system'::TEXT          AS identity_type,
      u.id                    AS auth_user_id,
      u.email,
      su.role                 AS role,
      1                       AS auth_level,
      NULL::UUID              AS station_id,
      'IoTank Governance'     AS station_name,
      'support@iotank.com'    AS station_email,
      '/iotank-logo.png'      AS logo_url,
      'System Guardian'       AS display_name,
      NULL                    AS photo_url,
      NULL::JSONB             AS address,
      NULL::TEXT              AS phone_number,
      to_jsonb(ARRAY[]::uuid[]) AS site_ids,
      FALSE                   AS security_pin_enabled, -- System users default to false for now
      su.created_at
    FROM auth.users u
    JOIN public.system_users su ON u.id = su.auth_user_id
    WHERE su.is_active = TRUE AND u.id = auth.uid()

    UNION ALL

    -- Station Users (Owners, Admins, Staff)
    SELECT
      'station'::TEXT         AS identity_type,
      u.id                    AS auth_user_id,
      p.email,
      p.role                  AS role,
      CASE 
        WHEN p.role = 'owner' THEN 5
        WHEN p.role = 'admin' THEN 5
        WHEN p.role = 'supervisor' THEN 6
        WHEN p.role = 'operator' THEN 7
        ELSE 8 
      END                     AS auth_level,
      p.station_id            AS station_id,
      COALESCE(fs.station_name, 'Organization Setup Pending') AS station_name,
      COALESCE(fs.email, p.email) AS station_email,
      fs.logo_url             AS logo_url,
      p.display_name,
      p.photo_url,
      CASE 
        WHEN fs.county IS NOT NULL OR fs.station_location IS NOT NULL THEN
          jsonb_build_object('state', fs.county, 'city', fs.station_location)
        ELSE NULL::JSONB
      END                     AS address,
      fs.phone                AS phone_number,
      to_jsonb(COALESCE(p.site_ids, '{}')) AS site_ids,
      COALESCE(p.security_pin_enabled, FALSE) AS security_pin_enabled,
      p.created_at
    FROM auth.users u
    JOIN public.profiles p ON u.id = p.auth_user_id
    LEFT JOIN public.fuel_stations fs ON p.station_id = fs.station_id
    WHERE u.id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = u.id AND is_active = TRUE)
  )
  SELECT to_jsonb(identity_set) INTO v_bundle FROM identity_set LIMIT 1;

  RETURN v_bundle;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- Ensure grants are preserved
GRANT EXECUTE ON FUNCTION public.get_user_bundle_v2() TO authenticated;

-- Reload Schema
NOTIFY pgrst, 'reload schema';
