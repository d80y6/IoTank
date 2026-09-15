-- supabase/migrations/20260428210000_unified_events_partitioning.sql
-- ============================================================================
-- PHASE 4: FORENSIC HARDENING (PARTITIONING & AUTOMATION)
-- ============================================================================

-- 1. CONVERT UNIFIED_EVENTS TO PARTITIONED TABLE
-- ============================================================================
-- We only run this if the table isn't already partitioned.
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM pg_tables 
        WHERE tablename = 'unified_events' 
        AND schemaname = 'public'
    ) AND NOT EXISTS (
        SELECT 1 
        FROM pg_partitioned_table p
        JOIN pg_class c ON p.partrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = 'unified_events'
        AND n.nspname = 'public'
    ) THEN
        -- A. Rename existing table
        ALTER TABLE public.unified_events RENAME TO unified_events_pre_partition;

        -- B. Create new partitioned table
        CREATE TABLE public.unified_events (
            id UUID DEFAULT gen_random_uuid(),
            station_id UUID REFERENCES public.fuel_stations(station_id) ON DELETE CASCADE,
            event_category TEXT NOT NULL CHECK (event_category IN ('SHIFT', 'DELIVERY', 'TEAM', 'SECURITY', 'SYSTEM', 'FINANCE', 'AI')),
            event_type TEXT NOT NULL,
            description TEXT,
            actor_id UUID REFERENCES auth.users(id),
            actor_email TEXT,
            metadata JSONB DEFAULT '{}',
            is_resolved BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (id, created_at)
        ) PARTITION BY RANGE (created_at);

        -- C. Create initial partitions
        PERFORM internal.create_event_partition(to_char(now() - interval '1 month', 'YYYY_MM'));
        PERFORM internal.create_event_partition(to_char(now(), 'YYYY_MM'));
        PERFORM internal.create_event_partition(to_char(now() + interval '1 month', 'YYYY_MM'));
        PERFORM internal.create_event_partition(to_char(now() + interval '2 month', 'YYYY_MM'));

        -- D. Migrate data
        INSERT INTO public.unified_events (id, station_id, event_category, event_type, description, actor_id, actor_email, metadata, is_resolved, created_at)
        SELECT id, station_id, event_category, event_type, description, actor_id, actor_email, metadata, is_resolved, created_at
        FROM public.unified_events_pre_partition;
    END IF;
END $$;

-- E. Restore Indexes & RLS
CREATE INDEX IF NOT EXISTS idx_unified_events_station_created ON public.unified_events(station_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_events_type_created ON public.unified_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_events_actor_time ON public.unified_events(actor_id, created_at DESC);

ALTER TABLE public.unified_events ENABLE ROW LEVEL SECURITY;

-- Re-apply RLS Policies
DROP POLICY IF EXISTS "Station members can view unified events" ON public.unified_events;
CREATE POLICY "Station members can view unified events" 
    ON public.unified_events
    FOR SELECT 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE station_id = unified_events.station_id 
            AND auth_user_id = auth.uid()
        ) OR 
        public.get_auth_level() <= 4
    );

DROP POLICY IF EXISTS "No updates to unified_events" ON public.unified_events;
CREATE POLICY "No updates to unified_events" 
    ON public.unified_events
    FOR UPDATE 
    TO authenticated 
    USING (false); -- Immutable

DROP POLICY IF EXISTS "Station admins can delete events" ON public.unified_events;
CREATE POLICY "Station admins can delete events" 
    ON public.unified_events
    FOR DELETE 
    TO authenticated 
    USING (
        public.get_auth_level() <= 4 OR 
        (
            public.get_auth_level() <= 6 AND 
            EXISTS (SELECT 1 FROM public.profiles WHERE auth_user_id = auth.uid() AND station_id = unified_events.station_id)
        )
    );

-- 2. AUTOMATED PARTITION MANAGEMENT JOB
-- ============================================================================
-- We use a function that can be called by pg_cron or a scheduled worker.

CREATE OR REPLACE FUNCTION internal.manage_event_partitions()
RETURNS VOID AS $$
BEGIN
    -- Create partition for next month
    PERFORM internal.create_event_partition(to_char(now() + interval '1 month', 'YYYY_MM'));
    -- Create partition for 2 months out
    PERFORM internal.create_event_partition(to_char(now() + interval '2 month', 'YYYY_MM'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. CLEANUP
-- ============================================================================
-- After verification, the old table can be dropped. 
-- For safety, we keep it for now but it's disconnected from the app.
-- DROP TABLE public.unified_events_pre_partition;

NOTIFY pgrst, 'reload schema';
