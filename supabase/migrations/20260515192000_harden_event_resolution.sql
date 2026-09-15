-- supabase/migrations/20260515192000_harden_event_resolution.sql
-- ============================================================================
-- FIX: Event Resolution Hardening & Cross-Station Security
-- ============================================================================

-- 1. Harden resolve_unified_event with Station Access Check & Atomic Alert Resolution
CREATE OR REPLACE FUNCTION public.resolve_unified_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_station_id uuid;
    v_event_station_id uuid;
    v_source_id uuid;
BEGIN
    -- Get user's station_id (handles both station users and system users)
    SELECT station_id INTO v_user_station_id FROM public.profiles WHERE auth_user_id = auth.uid();
    
    -- Get event's station_id and source_id from metadata
    SELECT station_id, (metadata->>'source_id')::uuid INTO v_event_station_id, v_source_id 
    FROM public.unified_events WHERE id = p_event_id;
    
    -- Security Check: Ensure user belongs to the station OR is a system admin
    IF v_user_station_id = v_event_station_id OR EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = auth.uid() AND is_active = TRUE) THEN
        -- 1. Resolve the event
        UPDATE public.unified_events 
        SET is_resolved = true 
        WHERE id = p_event_id;

        -- 2. Atomic: Resolve linked alert if exists
        IF v_source_id IS NOT NULL THEN
            UPDATE public.alerts 
            SET is_resolved = true, 
                resolved_at = NOW(), 
                resolved_by = 'SYSTEM_SYNC'
            WHERE id = v_source_id AND is_resolved = false;
        END IF;
    ELSE
        RAISE EXCEPTION 'Access Denied: You do not have permission to resolve events for this station.';
    END IF;
END;
$$;

-- 2. Harden resolve_all_station_events with Station Access Check & Bulk Alert Resolution
CREATE OR REPLACE FUNCTION public.resolve_all_station_events(p_station_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_station_id uuid;
BEGIN
    -- Get user's station_id
    SELECT station_id INTO v_user_station_id FROM public.profiles WHERE auth_user_id = auth.uid();
    
    -- Security Check
    IF v_user_station_id = p_station_id OR EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = auth.uid() AND is_active = TRUE) THEN
        -- 1. Resolve all events for the station
        UPDATE public.unified_events 
        SET is_resolved = true 
        WHERE station_id = p_station_id AND is_resolved = false;

        -- 2. Atomic: Resolve all alerts for the station to ensure UI consistency
        UPDATE public.alerts
        SET is_resolved = true,
            resolved_at = NOW(),
            resolved_by = 'SYSTEM_BATCH_SYNC'
        WHERE station_id = p_station_id AND is_resolved = false;
    ELSE
        RAISE EXCEPTION 'Access Denied: You do not have permission to resolve events for this station.';
    END IF;
END;
$$;

-- 3. Revoke & Grant
REVOKE EXECUTE ON FUNCTION public.resolve_unified_event(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_all_station_events(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_unified_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_all_station_events(uuid) TO authenticated;

-- 4. Reload Schema
NOTIFY pgrst, 'reload schema';
