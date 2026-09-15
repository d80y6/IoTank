-- supabase/migrations/20260601000001_swap_partitioning.sql
-- ============================================================================
-- SAAS SCALABILITY: Telemetry Table Swap (Ultra-Robust Sync)
-- ============================================================================
DO $$
DECLARE v_sql TEXT;
v_source_table TEXT := 'sensor_readings_legacy';
v_target_table TEXT := 'sensor_readings';
v_col_station TEXT;
v_col_std_vol TEXT;
v_col_temp TEXT;
v_col_time TEXT;
v_col_meta TEXT;
v_is_partitioned BOOLEAN;
BEGIN -- 0. Check if target is already partitioned (meaning swap was already successful)
SELECT EXISTS (
        SELECT 1
        FROM pg_partitioned_table
        WHERE partrelid = 'public.sensor_readings'::regclass
    ) INTO v_is_partitioned;
-- 1. Renames (Only if not already swapped)
IF NOT v_is_partitioned THEN -- Move existing table to legacy if legacy doesn't exist
IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'sensor_readings'
        AND table_schema = 'public'
) THEN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'sensor_readings_legacy'
        AND table_schema = 'public'
) THEN
ALTER TABLE public.sensor_readings
    RENAME TO sensor_readings_legacy;
ELSE -- Legacy exists, so sensor_readings might be a redundant table or another attempt
-- Rename it with a timestamp to be safe
EXECUTE 'ALTER TABLE public.sensor_readings RENAME TO sensor_readings_backup_' || to_char(now(), 'YYYYMMDD_HH24MISS');
END IF;
END IF;
-- Rename partitioned table to take over
IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'sensor_readings_partitioned'
        AND table_schema = 'public'
) THEN
ALTER TABLE public.sensor_readings_partitioned
    RENAME TO sensor_readings;
END IF;
END IF;
-- 2. Setup Partitions (Ensure default exists)
IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = v_target_table
        AND table_schema = 'public'
) THEN IF EXISTS (
    SELECT 1
    FROM pg_partitioned_table
    WHERE partrelid = 'public.sensor_readings'::regclass
) THEN IF NOT EXISTS (
    SELECT 1
    FROM pg_inherits i
        JOIN pg_class c ON i.inhrelid = c.oid
    WHERE i.inhparent = 'public.sensor_readings'::regclass
        AND c.relname = 'sensor_readings_default'
) THEN EXECUTE 'CREATE TABLE IF NOT EXISTS public.sensor_readings_default PARTITION OF public.sensor_readings DEFAULT';
END IF;
END IF;
END IF;
-- 3. Data Migration (From legacy to partitioned)
IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = v_source_table
        AND table_schema = 'public'
) THEN
SELECT column_name INTO v_col_station
FROM information_schema.columns
WHERE table_name = v_source_table
    AND column_name IN ('station_id', 'client_id')
LIMIT 1;
SELECT column_name INTO v_col_std_vol
FROM information_schema.columns
WHERE table_name = v_source_table
    AND column_name IN (
        'standard_volume',
        'corrected_volume',
        'volume_corrected'
    )
LIMIT 1;
SELECT column_name INTO v_col_temp
FROM information_schema.columns
WHERE table_name = v_source_table
    AND column_name = 'temperature'
LIMIT 1;
SELECT column_name INTO v_col_time
FROM information_schema.columns
WHERE table_name = v_source_table
    AND column_name IN ('timestamp', 'captured_at', 'created_at')
LIMIT 1;
SELECT column_name INTO v_col_meta
FROM information_schema.columns
WHERE table_name = v_source_table
    AND column_name = 'metadata'
LIMIT 1;
-- Construction & Execution (Hardened with COALESCE and conflict target)
v_sql := 'INSERT INTO public.' || v_target_table || ' (id, station_id, tank_id, volume, volume_corrected, temperature, captured_at, metadata) ' || 'SELECT ' || 'id, ' || COALESCE(v_col_station, 'NULL') || ', ' || 'tank_id, ' || 'volume, ' || COALESCE(v_col_std_vol, 'volume') || ', ' || COALESCE(v_col_temp, '0') || ', ' || 'COALESCE(' || COALESCE(v_col_time, 'now()') || ', now()), ' || COALESCE(v_col_meta, '''{}''::jsonb') || ' FROM public.' || v_source_table || ' ' || 'ON CONFLICT (id, captured_at) DO NOTHING';
EXECUTE v_sql;
END IF;
END $$;
-- 4. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_sensor_readings_station_id ON public.sensor_readings(station_id);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_tank_id ON public.sensor_readings(tank_id);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_captured_at ON public.sensor_readings(captured_at);