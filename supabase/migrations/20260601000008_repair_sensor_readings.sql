-- supabase/migrations/20260601000008_repair_sensor_readings.sql
-- ============================================================================
-- REPAIR: Re-run sensor_readings data migration (Forensic Recovery)
-- ============================================================================
-- This migration fixes the silent failure that occurred in 20260601000001.

DO $$ 
DECLARE
    v_sql TEXT;
    v_source_table TEXT := 'sensor_readings_legacy';
    v_target_table TEXT := 'sensor_readings';
    v_col_station TEXT;
    v_col_std_vol TEXT;
    v_col_temp TEXT;
    v_col_time TEXT;
    v_col_meta TEXT;
    v_target_count BIGINT;
    v_source_count BIGINT;
BEGIN
    -- 1. Check counts
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = v_target_table AND table_schema = 'public') THEN
        EXECUTE format('SELECT count(*) FROM public.%I', v_target_table) INTO v_target_count;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = v_source_table AND table_schema = 'public') THEN
        EXECUTE format('SELECT count(*) FROM public.%I', v_source_table) INTO v_source_count;
    END IF;

    -- 2. Only proceed if target is empty and source has data
    IF COALESCE(v_target_count, 0) = 0 AND COALESCE(v_source_count, 0) > 0 THEN
        
        RAISE NOTICE 'Repairing sensor_readings data migration (% rows in legacy)...', v_source_count;

        SELECT column_name INTO v_col_station FROM information_schema.columns WHERE table_name = v_source_table AND column_name IN ('station_id', 'client_id') LIMIT 1;
        SELECT column_name INTO v_col_std_vol FROM information_schema.columns WHERE table_name = v_source_table AND column_name IN ('standard_volume', 'corrected_volume', 'volume_corrected') LIMIT 1;
        SELECT column_name INTO v_col_temp FROM information_schema.columns WHERE table_name = v_source_table AND column_name = 'temperature' LIMIT 1;
        SELECT column_name INTO v_col_time FROM information_schema.columns WHERE table_name = v_source_table AND column_name IN ('timestamp', 'captured_at', 'created_at') LIMIT 1;
        SELECT column_name INTO v_col_meta FROM information_schema.columns WHERE table_name = v_source_table AND column_name = 'metadata' LIMIT 1;

        -- Construction & Execution (Hardened with COALESCE and conflict target)
        v_sql := 'INSERT INTO public.' || v_target_table || ' (id, station_id, tank_id, volume, volume_corrected, temperature, captured_at, metadata) ' ||
                 'SELECT ' ||
                 'id, ' ||
                 COALESCE(v_col_station, 'NULL') || ', ' ||
                 'tank_id, ' ||
                 'volume, ' ||
                 COALESCE(v_col_std_vol, 'volume') || ', ' ||
                 COALESCE(v_col_temp, '0') || ', ' ||
                 'COALESCE(' || COALESCE(v_col_time, 'now()') || ', now()), ' ||
                 COALESCE(v_col_meta, '''{}''::jsonb') || ' FROM public.' || v_source_table || ' ' ||
                 'ON CONFLICT (id, captured_at) DO NOTHING';

        EXECUTE v_sql;
        
        RAISE NOTICE 'Data migration complete.';
    ELSE
        RAISE NOTICE 'Skipping repair: target count %, source count %.', v_target_count, v_source_count;
    END IF;

    -- Audit other cores
    SELECT count(*) INTO v_target_count FROM public.fuel_stations;
    RAISE NOTICE 'Audit: fuel_stations count = %', v_target_count;
    SELECT count(*) INTO v_target_count FROM public.profiles;
    RAISE NOTICE 'Audit: profiles count = %', v_target_count;
    SELECT count(*) INTO v_target_count FROM public.tanks;
    RAISE NOTICE 'Audit: tanks count = %', v_target_count;

END $$;
