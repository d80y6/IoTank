-- supabase/migrations/20260514010000_update_unified_events_constraint.sql
-- ============================================================================
-- FIX: Update unified_events check constraint to allow 'ORDER' category.
-- ============================================================================

DO $$ 
BEGIN
    -- 1. Parent Table Constraint Update
    -- We drop the existing constraint on the PARENT table.
    -- CASCADE is used to ensure inherited constraints in partitions are handled.
    
    -- Try both potential names (standard and any manually added ones)
    ALTER TABLE public.unified_events DROP CONSTRAINT IF EXISTS unified_events_event_category_check CASCADE;
    ALTER TABLE public.unified_events DROP CONSTRAINT IF EXISTS unified_events_event_category_check1 CASCADE;

    -- 2. Add the new expanded constraint to the parent
    -- This will be inherited by all existing and future partitions.
    ALTER TABLE public.unified_events ADD CONSTRAINT unified_events_event_category_check 
    CHECK (event_category IN ('SHIFT', 'DELIVERY', 'ORDER', 'TEAM', 'SECURITY', 'SYSTEM', 'FINANCE', 'AI', 'CALIBRATION'));

END $$;

-- 3. Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
