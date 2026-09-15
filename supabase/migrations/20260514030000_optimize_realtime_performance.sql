-- supabase/migrations/20260514030000_optimize_realtime_performance.sql
-- ============================================================================
-- OPTIMIZATION: Zero-Latency Realtime Telemetry
-- ============================================================================

-- 1. Ensure high-performance indexing for realtime filters
-- Realtime filters on 'station_id' are much faster with an index.
CREATE INDEX IF NOT EXISTS idx_sensor_readings_station_realtime ON public.sensor_readings (station_id);

-- 2. Enable REPLICA IDENTITY FULL for sensor_readings
-- This ensures that all column data is available to the realtime publication
-- even for complex filtering and updates.
ALTER TABLE public.sensor_readings REPLICA IDENTITY FULL;

-- 3. Enable REPLICA IDENTITY FULL for tanks
-- This ensures the UI gets the full tank state immediately on trigger updates.
ALTER TABLE public.tanks REPLICA IDENTITY FULL;

-- 4. RELOAD: PostgREST Schema
NOTIFY pgrst, 'reload schema';
