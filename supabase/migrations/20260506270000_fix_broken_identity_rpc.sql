-- supabase/migrations/20260506270000_fix_broken_identity_rpc.sql
-- ============================================================================
-- EMERGENCY FIX: Identity Bundle RPC Column Mismatch
-- ============================================================================
-- The previous migration attempted to select non-existent columns 'address' 
-- and 'phone_number' from the profiles table, causing a 400 Bad Request.
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
      -- FIX: Return NULL for columns that don't exist in the current profiles schema
      NULL::JSONB             AS address,
      NULL::TEXT              AS phone_number,
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
    LEFT JOIN public.fuel_stations fs ON p.station_id = fs.station_id
    WHERE p.auth_user_id = v_uid
    LIMIT 1
  )
  SELECT to_jsonb(identity.*) INTO v_result FROM identity;

  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
