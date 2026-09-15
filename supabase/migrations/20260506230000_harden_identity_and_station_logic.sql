-- supabase/migrations/20260506230000_harden_identity_and_station_logic.sql
-- ============================================================================
-- HARDENING IDENTITY HANDSHAKE & STATION METADATA
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
        ARRAY[]::UUID[]         AS site_ids,
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

-- Ensure RLS allows users to see their own station data even if not yet fully provisioned
-- This helps the BillingPage fetch basic info if the record exists but is sparse.
ALTER POLICY "Station owners can manage their Paystack config" ON public.paystack_config
USING (auth.uid() IN (SELECT owner_id FROM fuel_stations WHERE station_id = paystack_config.station_id));

NOTIFY pgrst, 'reload schema';
