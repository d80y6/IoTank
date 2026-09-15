-- supabase/migrations/99999999000004_fix_station_setup_trigger.sql
-- ============================================================================
-- STATION SETUP TRIGGER REPAIR (V2.3.0)
-- 1. Split setup trigger to avoid FK violations on unified_events
-- 2. Force refresh of get_admin_risk_matrix
-- ============================================================================

-- STEP 1: Refactor Station Setup Logic
-- ============================================================================

-- BEFORE INSERT: Handle column defaults and initialization
CREATE OR REPLACE FUNCTION public.handle_new_station_setup_before()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sub_status := 'TRIAL';
    NEW.trial_ends_at := NOW() + INTERVAL '14 days';
    NEW.current_debt := 0;
    NEW.total_paid := 0;
    NEW.next_billing_date := NOW() + INTERVAL '14 days';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- AFTER INSERT: Handle logging (when station_id is now valid for FKs)
CREATE OR REPLACE FUNCTION public.handle_new_station_setup_after()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.unified_events (
        station_id,
        event_category,
        event_type,
        description,
        metadata,
        severity
    ) VALUES (
        NEW.station_id,
        'SYSTEM',
        'ACCOUNT_CREATED',
        'Station ' || NEW.station_name || ' initialized on 14-day free trial.',
        jsonb_build_object(
            'trial_ends_at', NEW.trial_ends_at,
            'sub_status', 'TRIAL'
        ),
        'INFO'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace existing triggers
DROP TRIGGER IF EXISTS on_station_created_setup ON public.fuel_stations;
DROP TRIGGER IF EXISTS on_station_created_setup_before ON public.fuel_stations;
DROP TRIGGER IF EXISTS on_station_created_setup_after ON public.fuel_stations;

CREATE TRIGGER on_station_created_setup_before
    BEFORE INSERT ON public.fuel_stations
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_station_setup_before();

CREATE TRIGGER on_station_created_setup_after
    AFTER INSERT ON public.fuel_stations
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_station_setup_after();


-- STEP 2: Force Refresh get_admin_risk_matrix
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_admin_risk_matrix();

CREATE OR REPLACE FUNCTION public.get_admin_risk_matrix()
RETURNS TABLE (
    actor_uid UUID,
    actor_email TEXT,
    high_risk_actions BIGINT,
    security_alerts BIGINT,
    risk_score FLOAT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.auth_user_id as actor_uid,
        u.email as actor_email,
        COUNT(e.id) FILTER (WHERE e.severity = 'CRITICAL') as high_risk_actions,
        COUNT(e.id) FILTER (WHERE e.event_category = 'SECURITY') as security_alerts,
        (COUNT(e.id) FILTER (WHERE e.severity = 'CRITICAL') * 10 + 
         COUNT(e.id) FILTER (WHERE e.event_category = 'SECURITY') * 5)::FLOAT as risk_score
    FROM public.system_users u
    LEFT JOIN public.unified_events e ON e.actor_id = u.auth_user_id
    GROUP BY u.auth_user_id, u.email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_risk_matrix() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_risk_matrix() TO service_role;

-- Reload
NOTIFY pgrst, 'reload schema';
