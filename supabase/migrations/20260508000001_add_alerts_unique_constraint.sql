-- supabase/migrations/20260508000001_add_alerts_unique_constraint.sql
-- ============================================================================
-- IDEMPOTENCY: Alerts Deduplication
-- ============================================================================
-- Adding a unique index to support ON CONFLICT upserts in the Market Intelligence
-- pipeline. This prevents duplicate news alerts for the same station.

DO $$ 
BEGIN
    -- Only create if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'alerts' 
        AND indexname = 'idx_alerts_station_type_title_unique'
    ) THEN
        CREATE UNIQUE INDEX idx_alerts_station_type_title_unique 
        ON public.alerts (station_id, alert_type, title);
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
