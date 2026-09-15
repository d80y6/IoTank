-- supabase/migrations/20260508000000_allow_event_resolution.sql
-- ============================================================================
-- FOR ENSIC INTEGRITY: Selective Resolution
-- ============================================================================
-- Allowing the 'is_resolved' flag to be toggled so users can dismiss notifications
-- while ensuring all other columns remain immutable for forensic audit purposes.

CREATE OR REPLACE FUNCTION public.prevent_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow updating ONLY the is_resolved column
    IF (TG_OP = 'UPDATE') THEN
        IF (OLD.id = NEW.id AND 
            OLD.station_id = NEW.station_id AND
            OLD.event_category = NEW.event_category AND
            OLD.event_type = NEW.event_type AND
            OLD.description = NEW.description AND
            OLD.actor_id = NEW.actor_id AND
            OLD.actor_email = NEW.actor_email AND
            OLD.metadata = NEW.metadata AND
            OLD.created_at = NEW.created_at) THEN
            
            -- Only is_resolved changed (or nothing changed)
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Forensic Integrity Violation: Audit logs (unified_events) are immutable and only the resolution status can be modified.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Update RLS Policy to allow UPDATE on is_resolved
DROP POLICY IF EXISTS "No updates to unified_events" ON public.unified_events;
DROP POLICY IF EXISTS "Users can resolve own station events" ON public.unified_events;
CREATE POLICY "Users can resolve own station events" 
    ON public.unified_events
    FOR UPDATE 
    TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE station_id = unified_events.station_id 
            AND auth_user_id = auth.uid()
        ) OR 
        public.get_auth_level() <= 4
    )
    WITH CHECK (
        -- Enforced by trigger, but added here for clarity
        is_resolved IS NOT NULL
    );

NOTIFY pgrst, 'reload schema';
