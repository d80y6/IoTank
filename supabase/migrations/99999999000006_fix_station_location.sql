-- supabase/migrations/99999999000006_fix_station_location.sql
-- ============================================================================
-- FIX: Station Location Display & Safe User Deletion
-- ============================================================================

-- STEP 1: Update get_user_bundle_v2 to include station location
-- ============================================================================
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
      -- Map the fuel_stations location columns to the address JSONB object
      CASE 
        WHEN fs.county IS NOT NULL OR fs.station_location IS NOT NULL THEN
          jsonb_build_object('state', fs.county, 'city', fs.station_location)
        ELSE NULL::JSONB
      END                     AS address,
      fs.phone                AS phone_number,
      to_jsonb(COALESCE(p.site_ids, '{}')) AS site_ids,
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

GRANT EXECUTE ON FUNCTION public.get_user_bundle_v2() TO authenticated;


-- STEP 2: RPC to safely delete a user, bypassing NO ACTION FK constraints
-- ============================================================================
-- The Supabase UI deletion fails because some audit/log tables have NO ACTION 
-- foreign keys pointing to auth.users. This RPC safely nullifies those links 
-- and deletes the user, preventing the "Database error deleting user".
CREATE OR REPLACE FUNCTION public.delete_user_safely(target_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- 1. Ensure caller is a Super Admin
    IF NOT EXISTS (
        SELECT 1 FROM public.system_users 
        WHERE auth_user_id = auth.uid() AND role = 'super_admin' AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Permission Denied: Only Super Admins can execute safe deletions.';
    END IF;

    -- 2. Nullify references in tables that block deletion (RESTRICT / NO ACTION)
    -- Unified Events (Audit Log) - Keep the log, remove the strict reference
    UPDATE public.unified_events SET actor_id = NULL WHERE actor_id = target_user_id;
    
    -- Support Tickets / Messages
    UPDATE public.ticket_messages SET sender_id = NULL WHERE sender_id = target_user_id;
    UPDATE public.system_notifications SET target_admin_id = NULL WHERE target_admin_id = target_user_id;
    
    -- Loss Reviews
    UPDATE public.loss_reviews SET reviewed_by = NULL WHERE reviewed_by = target_user_id;

    -- 3. Delete from public schema profiles (if not already CASCADE)
    DELETE FROM public.profiles WHERE auth_user_id = target_user_id;
    DELETE FROM public.system_users WHERE auth_user_id = target_user_id;

    -- 4. Finally, delete from auth.users
    DELETE FROM auth.users WHERE id = target_user_id;

    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to safely delete user: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

GRANT EXECUTE ON FUNCTION public.delete_user_safely(UUID) TO authenticated;

-- Reload PostgREST
NOTIFY pgrst, 'reload schema';
