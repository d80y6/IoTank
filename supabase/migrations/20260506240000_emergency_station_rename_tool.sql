-- supabase/migrations/20260506240000_emergency_station_rename_tool.sql
-- ============================================================================
-- EMERGENCY TOOL: Self-Provisioning for Station Names
-- ============================================================================

CREATE OR REPLACE FUNCTION public.emergency_set_station_name(p_name TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
DECLARE
    v_station_id UUID;
BEGIN
    -- Get the station ID for the current user
    SELECT station_id INTO v_station_id FROM public.profiles WHERE auth_user_id = auth.uid();
    
    IF v_station_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Update or Insert into fuel_stations
    INSERT INTO public.fuel_stations (station_id, station_name, owner_id)
    VALUES (v_station_id, p_name, auth.uid())
    ON CONFLICT (station_id) DO UPDATE 
    SET station_name = EXCLUDED.station_name,
        owner_id = COALESCE(fuel_stations.owner_id, EXCLUDED.owner_id);

    RETURN TRUE;
END;
$$;
