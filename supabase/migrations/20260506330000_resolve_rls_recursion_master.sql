-- supabase/migrations/20260506330000_resolve_rls_recursion_master.sql
-- ============================================================================
-- MASTER REPAIR: Resolve RLS Recursion (Fixing 500 Errors)
-- ============================================================================

-- 1. Helper Functions (Non-Recursive)
-- These must be SECURITY DEFINER to bypass RLS when called from RLS policies.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_is_super_admin()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.system_users 
    WHERE auth_user_id = auth.uid() 
    AND role = 'super_admin' 
    AND is_active = TRUE
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.check_is_staff()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.system_users 
    WHERE auth_user_id = auth.uid() 
    AND is_active = TRUE
  );
END;
$$ LANGUAGE plpgsql;

-- 2. Repair system_users RLS
-- ============================================================================
DROP POLICY IF EXISTS "System users can read own record" ON public.system_users;
DROP POLICY IF EXISTS "Super Admins can manage system users" ON public.system_users;

CREATE POLICY "System users can read own record"
    ON public.system_users FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

CREATE POLICY "Super Admins can manage system users"
    ON public.system_users FOR ALL
    TO authenticated
    USING (public.check_is_super_admin());

-- 3. Repair profiles RLS
-- ============================================================================
DROP POLICY IF EXISTS "Profiles self-visibility" ON public.profiles;
DROP POLICY IF EXISTS "Profiles self-update" ON public.profiles;

CREATE POLICY "Profiles self-visibility"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid() OR public.check_is_staff());

CREATE POLICY "Profiles self-update"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());

-- 4. Repair fuel_stations RLS
-- ============================================================================
DROP POLICY IF EXISTS "Station visibility" ON public.fuel_stations;
DROP POLICY IF EXISTS "Super Admin station management" ON public.fuel_stations;

CREATE POLICY "Station visibility"
    ON public.fuel_stations FOR SELECT
    TO authenticated
    USING (
        station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid())
        OR public.check_is_staff()
    );

CREATE POLICY "Super Admin station management"
    ON public.fuel_stations FOR UPDATE
    TO authenticated
    USING (public.check_is_super_admin())
    WITH CHECK (public.check_is_super_admin());

-- 5. RELOAD PostgREST
-- ============================================================================
NOTIFY pgrst, 'reload schema';
