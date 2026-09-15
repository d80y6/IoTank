-- supabase/migrations/20260506310000_restore_system_admin_identity_and_fix_ids.sql
-- ============================================================================
-- CRITICAL FIX: Restore System Admin Identity & Align ID Handshakes
-- ============================================================================
-- 1. Restores the UNION ALL for system_users in get_user_bundle_v2.
-- 2. Ensures all identity functions use 'auth_user_id' strictly.
-- 3. Standardizes the site_ids array handling to prevent null pointer errors.
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

  BEGIN
    WITH identity AS (
      -- 1. Check system_users (IoTank Staff)
      SELECT
        'system'::TEXT          AS identity_type,
        su.role,
        su.display_name,
        su.photo_url,
        NULL::UUID              AS station_id,
        'IoTank Governance'     AS station_name,
        '/iotank-logo.png'      AS logo_url,
        NULL::TEXT              AS county,
        NULL::JSONB             AS address,
        NULL::TEXT              AS phone_number,
        ARRAY[]::UUID[]         AS site_ids,
        FALSE                   AS mfa_enabled,
        su.is_active,
        su.created_at,
        su.email,
        CASE su.role
          WHEN 'super_admin'   THEN 1
          WHEN 'admin_helper'  THEN 2
          WHEN 'support_staff' THEN 3
          WHEN 'analyst'       THEN 4
          ELSE 99
        END                     AS auth_level
      FROM public.system_users su
      WHERE su.auth_user_id = v_uid AND su.is_active = TRUE

      UNION ALL

      -- 2. Check profiles (Station Users)
      SELECT
        'profile'::TEXT         AS identity_type,
        p.role,
        p.display_name,
        p.photo_url,
        p.station_id,
        COALESCE(fs.station_name, 'Organization Setup Pending') AS station_name,
        fs.logo_url,
        fs.county,
        NULL::JSONB             AS address,
        NULL::TEXT              AS phone_number,
        COALESCE(p.site_ids, ARRAY[]::UUID[]) AS site_ids,
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
      LEFT JOIN public.fuel_stations fs ON p.station_id = fs.station_id
      WHERE p.auth_user_id = v_uid
      LIMIT 1
    )
    SELECT to_jsonb(identity.*)
    INTO v_result
    FROM identity
    LIMIT 1;

    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'identity_type', 'error',
      'error_code', SQLSTATE,
      'error_message', SQLERRM
    );
  END;
END;
$$;

-- Ensure get_station_id_from_auth is also strictly aligned
CREATE OR REPLACE FUNCTION public.get_station_id_from_auth()
RETURNS UUID AS $$
BEGIN
    RETURN (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth;

NOTIFY pgrst, 'reload schema';
