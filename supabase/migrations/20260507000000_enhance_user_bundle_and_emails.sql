-- supabase/migrations/20260507000000_enhance_user_bundle_and_emails.sql
-- ============================================================================
-- ENHANCEMENT: Identity Bundle & Station Email Exposure
-- ============================================================================

-- 1. Ensure fuel_stations has the email column (from client_billing)
-- This was already in initial_schema but we ensure it's not missing.
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fuel_stations' AND column_name = 'email') THEN
        ALTER TABLE public.fuel_stations ADD COLUMN email TEXT;
    END IF;
END $$;

-- 2. Update get_user_bundle_v2 to include station_email
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_user_bundle_v2()
RETURNS JSONB AS $$
DECLARE v_bundle JSONB;
BEGIN
  -- We use a CTE to collect the data before building the final JSON object
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
      'support@iotank.com'    AS station_email, -- Default governance support
      '/iotank-logo.png'      AS logo_url,
      'System Guardian'       AS display_name,
      NULL                    AS photo_url,
      NULL::JSONB             AS address,
      NULL::TEXT              AS phone_number,
      to_jsonb(ARRAY[]::uuid[]) AS site_ids,
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
      COALESCE(fs.email, p.email) AS station_email, -- Use station email, fallback to personal
      fs.logo_url             AS logo_url,
      p.display_name,
      p.photo_url,
      NULL::JSONB             AS address, -- address is in sites or profiles, not fuel_stations
      fs.phone                AS phone_number,
      to_jsonb(COALESCE(p.site_ids, '{}')) AS site_ids,
      p.created_at
    FROM auth.users u
    JOIN public.profiles p ON u.id = p.auth_user_id
    LEFT JOIN public.fuel_stations fs ON p.station_id = fs.station_id
    WHERE u.id = auth.uid()
    -- Ensure we don't return a record if the user is already a system user (to avoid duplicates in UNION)
    AND NOT EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = u.id AND is_active = TRUE)
  )
  SELECT to_jsonb(identity_set) INTO v_bundle FROM identity_set LIMIT 1;

  RETURN v_bundle;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_bundle_v2() TO authenticated;

-- Reload PostgREST
NOTIFY pgrst, 'reload schema';
