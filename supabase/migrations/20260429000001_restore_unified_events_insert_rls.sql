-- supabase/migrations/20260429000001_restore_unified_events_insert_rls.sql
-- ============================================================================
-- Restore INSERT RLS policy for the newly partitioned unified_events table
-- ============================================================================

-- 1. Restore INSERT policy for authenticated users
DROP POLICY IF EXISTS "Allow authenticated inserts to unified_events" ON public.unified_events;
CREATE POLICY "Allow authenticated inserts to unified_events"
    ON public.unified_events
    FOR INSERT
    TO authenticated
    WITH CHECK (
        actor_id = auth.uid()
    );

-- 2. Allow service role complete access for automated edge function inserts
DROP POLICY IF EXISTS "Service role may insert unified_events" ON public.unified_events;
CREATE POLICY "Service role may insert unified_events"
    ON public.unified_events
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- 3. Reload schema cache just in case
NOTIFY pgrst, 'reload schema';
