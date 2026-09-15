-- supabase/migrations/20260514050000_fix_realtime_partitioning.sql
-- ============================================================================
-- FIX: Realtime Subscriptions for Partitioned Telemetry
-- ============================================================================
-- By default, Postgres publications do not broadcast changes from child 
-- partitions when subscribing to the parent table. 
-- We enable 'publish_via_partition_root' to ensure 'sensor_readings' 
-- listeners receive data regardless of which monthly partition it hits.
-- ============================================================================

-- 1. Enable partition root publishing for the realtime publication
ALTER PUBLICATION supabase_realtime SET (publish_via_partition_root = true);

-- 2. Ensure REPLICA IDENTITY FULL is set on all CURRENT partitions
-- This ensures that even if we use complex filters, Realtime has all the data.
DO $$ 
DECLARE 
    partition_record RECORD;
BEGIN
    FOR partition_record IN 
        SELECT tablename 
        FROM pg_catalog.pg_tables 
        WHERE schemaname = 'public' 
        AND tablename LIKE 'sensor_readings_%'
    LOOP
        EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', partition_record.tablename);
    END LOOP;
END $$;

-- 3. Also ensure the parent has it
ALTER TABLE public.sensor_readings REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
