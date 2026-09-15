-- supabase/migrations/99999999000007_fix_auth_cascade_delete.sql
-- ============================================================================
-- FIX: Allow Safe User Deletion from Supabase Dashboard
-- Updates foreign key constraints from NO ACTION/RESTRICT to SET NULL/CASCADE
-- ============================================================================

DO $$ 
BEGIN
    -- 1. Fix ticket_messages (keep ticket but remove sender link)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ticket_messages_sender_id_fkey') THEN
        ALTER TABLE public.ticket_messages DROP CONSTRAINT ticket_messages_sender_id_fkey;
        ALTER TABLE public.ticket_messages ADD CONSTRAINT ticket_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;

    -- 2. Fix system_notifications (delete notifications for deleted admin)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'system_notifications_target_admin_id_fkey') THEN
        ALTER TABLE public.system_notifications DROP CONSTRAINT system_notifications_target_admin_id_fkey;
        ALTER TABLE public.system_notifications ADD CONSTRAINT system_notifications_target_admin_id_fkey FOREIGN KEY (target_admin_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    -- 3. Fix loss_reviews (keep review but remove reviewer link)
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'loss_reviews_reviewed_by_fkey') THEN
        ALTER TABLE public.loss_reviews DROP CONSTRAINT loss_reviews_reviewed_by_fkey;
        ALTER TABLE public.loss_reviews ADD CONSTRAINT loss_reviews_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;

    -- 4. Fix unified_events (keep audit log but remove actor link)
    -- We need to check both common naming patterns for the constraint
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'unified_events_actor_id_fkey1') THEN
        ALTER TABLE public.unified_events DROP CONSTRAINT unified_events_actor_id_fkey1;
        ALTER TABLE public.unified_events ADD CONSTRAINT unified_events_actor_id_fkey1 FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    ELSIF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'unified_events_actor_id_fkey') THEN
        ALTER TABLE public.unified_events DROP CONSTRAINT unified_events_actor_id_fkey;
        ALTER TABLE public.unified_events ADD CONSTRAINT unified_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;

END $$;
