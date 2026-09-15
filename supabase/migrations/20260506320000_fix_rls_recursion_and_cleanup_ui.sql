-- supabase/migrations/20260506320000_fix_rls_recursion_and_cleanup_ui.sql
-- ============================================================================
-- CRITICAL REPAIR: Resolve RLS Recursion & Identity Deadlocks
-- ============================================================================
-- Problem: RLS policies on system_users/profiles were calling functions that 
-- queried the same tables, causing infinite loops and 400 errors.
-- ============================================================================

-- 1. CLEANUP SYSTEM_USERS RLS (PRIMARY SOURCE OF RECURSION)
-- ============================================================================
ALTER TABLE public.system_users DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Super Admins can manage all users" ON public.system_users;
DROP POLICY IF EXISTS "System users can read their own identity" ON public.system_users;
DROP POLICY IF EXISTS "IoTank staff can view system users" ON public.system_users;
DROP POLICY IF EXISTS "System users can read own record" ON public.system_users;
DROP POLICY IF EXISTS "Super Admins can manage system users" ON public.system_users;

-- Re-enable with NON-RECURSIVE policies
ALTER TABLE public.system_users ENABLE ROW LEVEL SECURITY;

-- Self access (Direct check)
CREATE POLICY "System users can read own record"
    ON public.system_users
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

-- Super Admin management (Direct check against table to avoid function loop)
CREATE POLICY "Super Admins can manage system users"
    ON public.system_users
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE auth_user_id = auth.uid() 
            AND role = 'super_admin' 
            AND is_active = TRUE
        )
    );

-- 2. CLEANUP PROFILES RLS
-- ============================================================================
DROP POLICY IF EXISTS "Users can read their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can see own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles self-visibility" ON public.profiles;
DROP POLICY IF EXISTS "Profiles self-update" ON public.profiles;

-- Restore standard profiles access
CREATE POLICY "Profiles self-visibility"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid() OR (
        EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE auth_user_id = auth.uid() 
            AND is_active = TRUE
        )
    ));

CREATE POLICY "Profiles self-update"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());

-- 3. CLEANUP FUEL_STATIONS RLS
-- ============================================================================
DROP POLICY IF EXISTS "Users can see own station info" ON public.fuel_stations;
DROP POLICY IF EXISTS "Super Admins can modify station profiles" ON public.fuel_stations;
DROP POLICY IF EXISTS "Authorized admins can update organization billing" ON public.fuel_stations;
DROP POLICY IF EXISTS "Station visibility" ON public.fuel_stations;
DROP POLICY IF EXISTS "Super Admin station management" ON public.fuel_stations;

-- SELECT: Own station or IoTank Staff
CREATE POLICY "Station visibility"
    ON public.fuel_stations
    FOR SELECT
    TO authenticated
    USING (
        station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = auth.uid() AND is_active = TRUE)
    );

-- UPDATE: Super Admins only (Using direct check)
CREATE POLICY "Super Admin station management"
    ON public.fuel_stations
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE auth_user_id = auth.uid() 
            AND role = 'super_admin' 
            AND is_active = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE auth_user_id = auth.uid() 
            AND role = 'super_admin' 
            AND is_active = TRUE
        )
    );

-- 4. HARDEN get_user_bundle_v2
-- Ensure it strictly uses auth_user_id and avoids any potential recursion triggers.
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
    -- IoTank Staff
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

    -- Station Users
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
      COALESCE(p.site_ids::UUID[], ARRAY[]::UUID[]) AS site_ids,
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

-- 5. RELOAD PostgREST
-- ============================================================================
NOTIFY pgrst, 'reload schema';
