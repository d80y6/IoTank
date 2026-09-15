-- supabase/migrations/20260515184500_harden_security_functions.sql
-- ============================================================================
-- FIX: Missing Security Functions & Persistence
-- ============================================================================

-- 1. Create missing disable_security_pin function
CREATE OR REPLACE FUNCTION public.disable_security_pin()
RETURNS VOID AS $$
BEGIN
    UPDATE public.profiles
    SET 
        security_pin_hash = NULL,
        security_pin_enabled = FALSE,
        last_pin_change_at = NOW()
    WHERE auth_user_id = auth.uid();
    
    -- Also update system_users if applicable
    UPDATE public.system_users
    SET security_pin_enabled = FALSE
    WHERE auth_user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- 2. Add security_pin_enabled to system_users if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_users' AND column_name = 'security_pin_enabled') THEN
        ALTER TABLE public.system_users ADD COLUMN security_pin_enabled BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- 3. Update setup_security_pin to handle system users too
CREATE OR REPLACE FUNCTION public.setup_security_pin(p_pin_hash TEXT)
RETURNS VOID AS $$
BEGIN
    -- Update profiles
    UPDATE public.profiles
    SET 
        security_pin_hash = p_pin_hash,
        security_pin_enabled = TRUE,
        last_pin_change_at = NOW()
    WHERE auth_user_id = auth.uid();

    -- Update system_users
    UPDATE public.system_users
    SET security_pin_enabled = TRUE
    WHERE auth_user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- 4. Update get_user_bundle_v2 to fetch PIN status for system users
CREATE OR REPLACE FUNCTION public.get_user_bundle_v2()
RETURNS JSONB AS $$
DECLARE v_bundle JSONB;
BEGIN
  WITH identity_set AS (
    -- System Governance Users
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
      COALESCE(su.security_pin_enabled, FALSE) AS security_pin_enabled,
      su.created_at
    FROM auth.users u
    JOIN public.system_users su ON u.id = su.auth_user_id
    WHERE su.is_active = TRUE AND u.id = auth.uid()

    UNION ALL

    -- Station Users
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

-- 5. Finalize Grants
GRANT EXECUTE ON FUNCTION public.disable_security_pin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.setup_security_pin(TEXT) TO authenticated;

-- Reload Schema
NOTIFY pgrst, 'reload schema';
