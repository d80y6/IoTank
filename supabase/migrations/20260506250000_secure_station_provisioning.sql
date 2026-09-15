-- supabase/migrations/20260506250000_secure_station_provisioning.sql
-- ============================================================================
-- SECURE STATION PROVISIONING & IMMUTABILITY
-- ============================================================================

CREATE OR REPLACE FUNCTION public.emergency_set_station_name(p_name TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
DECLARE
    v_station_id UUID;
    v_user_email TEXT;
    v_existing_name TEXT;
BEGIN
    -- 1. Identify User Context
    SELECT station_id, email INTO v_station_id, v_user_email 
    FROM public.profiles 
    WHERE auth_user_id = auth.uid();
    
    IF v_station_id IS NULL THEN
        RAISE EXCEPTION 'Identity mismatch: User is not associated with any station ID.';
    END IF;

    -- 2. Check for Immutability Requirement
    -- Once a station has a name (that isn't the pending placeholder), only Super Admins can change it.
    SELECT station_name INTO v_existing_name 
    FROM public.fuel_stations 
    WHERE station_id = v_station_id;

    IF v_existing_name IS NOT NULL AND v_existing_name != 'Organization Setup Pending' THEN
        -- Check if current user is a super admin
        IF NOT EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = auth.uid() AND role = 'super_admin') THEN
            RAISE EXCEPTION 'Security Policy: Station names are immutable once registered. Contact System Governance for changes.';
        END IF;
    END IF;

    -- 3. Provision or Update
    INSERT INTO public.fuel_stations (
        station_id, 
        station_name, 
        owner_id, 
        email, 
        account_status,
        created_at
    )
    VALUES (
        v_station_id, 
        p_name, 
        auth.uid(), 
        COALESCE(v_user_email, 'pending@iotank.com'), 
        'active',
        NOW()
    )
    ON CONFLICT (station_id) DO UPDATE 
    SET station_name = EXCLUDED.station_name,
        owner_id = COALESCE(fuel_stations.owner_id, EXCLUDED.owner_id),
        email = COALESCE(fuel_stations.email, EXCLUDED.email);

    RETURN TRUE;
END;
$$;

-- 4. Enforce Immutability via RLS for standard table updates
DROP POLICY IF EXISTS "Station owners can update their own station" ON public.fuel_stations;
CREATE POLICY "Station owners can update their own station" ON public.fuel_stations
FOR UPDATE
USING (
    auth.uid() = owner_id 
    AND (
        station_name IS NULL 
        OR station_name = 'Organization Setup Pending'
    )
)
WITH CHECK (
    auth.uid() = owner_id
);

-- Super Admins can always update everything
DROP POLICY IF EXISTS "Super Admins have full access to fuel_stations" ON public.fuel_stations;
CREATE POLICY "Super Admins have full access to fuel_stations" ON public.fuel_stations
FOR ALL
USING (EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = auth.uid() AND role = 'super_admin'));

NOTIFY pgrst, 'reload schema';
