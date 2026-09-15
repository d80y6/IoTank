-- supabase/migrations/20260506300000_finalize_shift_and_station_integrity.sql
-- ============================================================================
-- FINAL INTEGRITY PATCH: Shift Closures & Station Profile Hardening
-- ============================================================================

DO $$ 
BEGIN
    -- 1. REPAIR shift_closures COLUMNS
    -- Ensure 'auth_user_id' exists (Standardized naming for the operator)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_closures' AND column_name = 'auth_user_id') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_closures' AND column_name = 'closed_by_uid') THEN
            ALTER TABLE public.shift_closures RENAME COLUMN closed_by_uid TO auth_user_id;
        ELSE
            ALTER TABLE public.shift_closures ADD COLUMN auth_user_id UUID REFERENCES auth.users(id);
        END IF;
    END IF;

    -- Ensure 'station_id' exists (Primary partition key)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_closures' AND column_name = 'station_id') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shift_closures' AND column_name = 'client_id') THEN
            ALTER TABLE public.shift_closures RENAME COLUMN client_id TO station_id;
        ELSE
            ALTER TABLE public.shift_closures ADD COLUMN station_id UUID REFERENCES public.fuel_stations(station_id);
        END IF;
    END IF;

    -- 2. HARDEN fuel_stations SCHEMA
    -- Set email to NOT NULL (Critical for provisioning and billing)
    -- We first clean up any nulls (though there shouldn't be any in a healthy DB)
    UPDATE public.fuel_stations SET email = 'pending_provisioning@iotank.com' WHERE email IS NULL;
    ALTER TABLE public.fuel_stations ALTER COLUMN email SET NOT NULL;

END $$;

-- 3. HARDEN fuel_stations RLS
-- Restrict UPDATE to Super Admins only (Auth Level <= 4)
-- ============================================================================
DROP POLICY IF EXISTS "Authorized admins can update organization billing" ON public.fuel_stations;
CREATE POLICY "Super Admins can modify station profiles"
    ON public.fuel_stations
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.get_auth_level()) <= 4)
    WITH CHECK ((SELECT public.get_auth_level()) <= 4);

-- 4. RELOAD PostgREST
-- ============================================================================
NOTIFY pgrst, 'reload schema';
