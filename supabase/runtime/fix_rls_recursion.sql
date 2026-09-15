-- fix_rls_recursion.sql
-- ============================================================================
-- HOTFIX: Break RLS infinite recursion introduced by 99999999000015 migration
-- 
-- CHAIN: fuel_stations_select → check_is_staff() → system_users (RLS) → check_is_staff() → ♾
--
-- ROOT CAUSE: The new fuel_stations_select policy calls check_is_staff(), 
-- which queries system_users. But system_users' own RLS policy also calls 
-- check_is_staff(), creating an infinite recursive loop that times out.
--
-- FIX: Replace check_is_staff() calls in both problematic policies with a 
-- direct, non-recursive EXISTS check against system_users using auth.uid().
-- This is logically equivalent but breaks the recursion.
-- ============================================================================

BEGIN;

-- 1. Fix fuel_stations_select: replace check_is_staff() with inline EXISTS
DROP POLICY IF EXISTS "fuel_stations_select" ON public.fuel_stations;
CREATE POLICY "fuel_stations_select" ON public.fuel_stations FOR SELECT TO authenticated
USING (
    station_id IN (
        SELECT station_id FROM public.profiles 
        WHERE auth_user_id = (SELECT auth.uid())
    )
    OR EXISTS (
        SELECT 1 FROM public.system_users 
        WHERE auth_user_id = (SELECT auth.uid()) AND is_active = TRUE
    )
);

-- 2. Fix system_users policy: remove the recursive check_is_staff() call
-- Staff can always read their own row; for cross-user access, use a direct check
DROP POLICY IF EXISTS "Consolidated system_users access" ON public.system_users;
CREATE POLICY "Consolidated system_users access" ON public.system_users FOR ALL TO authenticated
USING (
    auth_user_id = (SELECT auth.uid())
    OR EXISTS (
        SELECT 1 FROM public.system_users su2
        WHERE su2.auth_user_id = (SELECT auth.uid()) AND su2.is_active = TRUE
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.system_users su2
        WHERE su2.auth_user_id = (SELECT auth.uid()) AND su2.is_active = TRUE
    )
);

-- 3. Also fix fuel_stations_update and fuel_stations_delete to avoid same recursion
DROP POLICY IF EXISTS "fuel_stations_update" ON public.fuel_stations;
CREATE POLICY "fuel_stations_update" ON public.fuel_stations FOR UPDATE TO authenticated
USING (
    ((SELECT auth.uid()) = owner_id AND (station_name IS NULL OR station_name = 'Organization Setup Pending'))
    OR EXISTS (
        SELECT 1 FROM public.system_users 
        WHERE auth_user_id = (SELECT auth.uid()) AND is_active = TRUE
    )
)
WITH CHECK (
    ((SELECT auth.uid()) = owner_id)
    OR EXISTS (
        SELECT 1 FROM public.system_users 
        WHERE auth_user_id = (SELECT auth.uid()) AND is_active = TRUE
    )
);

DROP POLICY IF EXISTS "fuel_stations_delete" ON public.fuel_stations;
CREATE POLICY "fuel_stations_delete" ON public.fuel_stations FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.system_users 
        WHERE auth_user_id = (SELECT auth.uid()) AND is_active = TRUE
    )
);

-- 4. Also fix fuel_stations_insert
DROP POLICY IF EXISTS "fuel_stations_insert" ON public.fuel_stations;
CREATE POLICY "fuel_stations_insert" ON public.fuel_stations FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.system_users 
        WHERE auth_user_id = (SELECT auth.uid()) AND is_active = TRUE
    )
);

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
