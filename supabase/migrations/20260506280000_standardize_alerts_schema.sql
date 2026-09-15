-- supabase/migrations/20260506280000_standardize_alerts_schema.sql
-- ============================================================================
-- SCHEMA STANDARDIZATION: Alerts Table
-- ============================================================================
-- Renaming columns to match the new authenticated identity convention.
-- ============================================================================

DO $$ 
BEGIN 
    -- 1. Rename acknowledged_by to acknowledged_by_auth_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alerts' AND column_name = 'acknowledged_by') THEN
        ALTER TABLE public.alerts RENAME COLUMN acknowledged_by TO acknowledged_by_auth_id;
    END IF;

    -- 2. Ensure station_id is used instead of client_id (Safety double-check)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alerts' AND column_name = 'client_id') THEN
        ALTER TABLE public.alerts RENAME COLUMN client_id TO station_id;
    END IF;

    -- 3. Add index for performance if missing
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_alerts_acknowledged_by') THEN
        CREATE INDEX idx_alerts_acknowledged_by ON public.alerts(acknowledged_by_auth_id);
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
