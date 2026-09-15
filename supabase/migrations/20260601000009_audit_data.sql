-- supabase/migrations/20260601000009_audit_data.sql
DO $$ 
DECLARE
    v_count BIGINT;
BEGIN
    SELECT count(*) INTO v_count FROM public.fuel_stations;
    RAISE NOTICE 'Audit: fuel_stations count = %', v_count;
    
    SELECT count(*) INTO v_count FROM public.profiles;
    RAISE NOTICE 'Audit: profiles count = %', v_count;
    
    SELECT count(*) INTO v_count FROM public.tanks;
    RAISE NOTICE 'Audit: tanks count = %', v_count;
    
    SELECT count(*) INTO v_count FROM public.sensor_readings;
    RAISE NOTICE 'Audit: sensor_readings count = %', v_count;

    SELECT count(*) INTO v_count FROM public.unified_events;
    RAISE NOTICE 'Audit: unified_events count = %', v_count;

    SELECT count(*) INTO v_count FROM public.alerts;
    RAISE NOTICE 'Audit: alerts count = %', v_count;
END $$;
