-- fix_rls_recursion_final.sql
-- ============================================================================
-- FINAL HOTFIX: Resolve system_users infinite RLS recursion
--
-- The previous hotfix replaced check_is_staff() with an inline EXISTS query 
-- against system_users. However, because system_users's own policy contained 
-- that EXISTS query, it still triggered itself recursively.
-- 
-- The only way to break RLS recursion is to query the table using a 
-- SECURITY DEFINER function. This restores check_is_staff() to the policies.
-- check_is_staff() was already fixed to be SECURITY DEFINER.
-- ============================================================================

BEGIN;

-- 1. Restore fuel_stations_select to use check_is_staff()
DROP POLICY IF EXISTS "fuel_stations_select" ON public.fuel_stations;
CREATE POLICY "fuel_stations_select" ON public.fuel_stations FOR SELECT TO authenticated
USING (
    station_id IN (
        SELECT station_id FROM public.profiles 
        WHERE auth_user_id = (SELECT auth.uid())
    )
    OR (SELECT public.check_is_staff() AS check_is_staff)
);

-- 2. Restore system_users policy to use check_is_staff()
DROP POLICY IF EXISTS "Consolidated system_users access" ON public.system_users;
CREATE POLICY "Consolidated system_users access" ON public.system_users FOR ALL TO authenticated
USING (
    auth_user_id = (SELECT auth.uid())
    OR (SELECT public.check_is_staff() AS check_is_staff)
)
WITH CHECK (
    auth_user_id = (SELECT auth.uid())
    OR (SELECT public.check_is_staff() AS check_is_staff)
);

-- 3. Restore fuel_stations_update to use check_is_staff()
DROP POLICY IF EXISTS "fuel_stations_update" ON public.fuel_stations;
CREATE POLICY "fuel_stations_update" ON public.fuel_stations FOR UPDATE TO authenticated
USING (
    ((SELECT auth.uid()) = owner_id AND (station_name IS NULL OR station_name = 'Organization Setup Pending'))
    OR (SELECT public.check_is_staff() AS check_is_staff)
)
WITH CHECK (
    ((SELECT auth.uid()) = owner_id)
    OR (SELECT public.check_is_staff() AS check_is_staff)
);

-- 4. Restore fuel_stations_delete to use check_is_staff()
DROP POLICY IF EXISTS "fuel_stations_delete" ON public.fuel_stations;
CREATE POLICY "fuel_stations_delete" ON public.fuel_stations FOR DELETE TO authenticated
USING (
    (SELECT public.check_is_staff() AS check_is_staff)
);

-- 5. Restore fuel_stations_insert
DROP POLICY IF EXISTS "fuel_stations_insert" ON public.fuel_stations;
CREATE POLICY "fuel_stations_insert" ON public.fuel_stations FOR INSERT TO authenticated
WITH CHECK (
    (SELECT public.check_is_staff() AS check_is_staff)
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
