-- supabase/migrations/20260507000001_fix_shift_constraints_and_audit.sql
-- ============================================================================
-- 1. FIX shift_closures constraints to allow 'OPEN' and 'NEEDS_REVIEW'
-- ============================================================================
ALTER TABLE public.shift_closures DROP CONSTRAINT IF EXISTS shift_closures_review_state_check;
ALTER TABLE public.shift_closures ADD CONSTRAINT shift_closures_review_state_check 
    CHECK (review_state IN ('OPEN', 'PENDING', 'APPROVED', 'DISPUTED', 'CLOSED', 'NEEDS_REVIEW'));

-- ============================================================================
-- 2. ENHANCE audit_trigger_handler for specific forensic alerts
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audit_trigger_handler()
RETURNS TRIGGER AS $$
DECLARE
    v_station_id UUID;
    v_actor_name TEXT;
    v_category TEXT := 'SYSTEM';
    v_should_audit BOOLEAN := TRUE;
    v_description TEXT;
    v_severity TEXT := 'INFO';
BEGIN
    -- Resolve station_id
    v_station_id := COALESCE(NEW.station_id, OLD.station_id);

    -- ── TELEMETRY FILTERING ─────────────────
    IF TG_TABLE_NAME = 'tanks' AND TG_OP = 'UPDATE' THEN
        IF (OLD.* IS NOT DISTINCT FROM NEW.*) THEN 
            v_should_audit := FALSE;
        ELSIF (OLD.current_volume IS DISTINCT FROM NEW.current_volume OR OLD.last_reading_at IS DISTINCT FROM NEW.last_reading_at)
              AND OLD.tank_name = NEW.tank_name AND OLD.tank_capacity = NEW.tank_capacity THEN
            v_should_audit := FALSE; 
        END IF;
    END IF;

    IF NOT v_should_audit THEN RETURN NEW; END IF;

    -- ── CATEGORY ASSIGNMENT ──────────────────
    IF TG_TABLE_NAME IN ('fuel_transactions', 'deliveries') THEN 
        v_category := 'DELIVERY';
    ELSIF TG_TABLE_NAME = 'shift_closures' THEN 
        v_category := 'SHIFT';
    ELSIF TG_TABLE_NAME = 'alerts' THEN 
        v_category := 'SECURITY';
    ELSIF TG_TABLE_NAME = 'billing' THEN 
        v_category := 'FINANCE';
    ELSIF TG_TABLE_NAME IN ('tanks', 'sites') THEN
        v_category := 'INVENTORY';
    END IF;

    -- ── DESCRIPTIVE LOGGING ──────────────────
    IF TG_TABLE_NAME = 'tanks' THEN
        IF TG_OP = 'INSERT' THEN v_description := 'New tank asset initialized: ' || NEW.tank_name;
        ELSIF TG_OP = 'UPDATE' THEN 
            IF OLD.tank_name <> NEW.tank_name THEN
                v_description := 'Tank renamed: ' || OLD.tank_name || ' -> ' || NEW.tank_name;
            ELSE
                v_description := 'Configuration modified for tank: ' || NEW.tank_name;
            END IF;
        ELSIF TG_OP = 'DELETE' THEN v_description := 'Permanent removal of tank asset: ' || OLD.tank_name;
        END IF;
    ELSIF TG_TABLE_NAME = 'sites' THEN
        IF TG_OP = 'INSERT' THEN v_description := 'New facility registered: ' || NEW.site_name;
        ELSIF TG_OP = 'UPDATE' THEN v_description := 'Site metadata updated: ' || NEW.site_name;
        ELSIF TG_OP = 'DELETE' THEN v_description := 'Facility record purged: ' || OLD.site_name;
        END IF;
    ELSIF TG_TABLE_NAME = 'alerts' THEN
        IF TG_OP = 'INSERT' THEN 
            v_description := 'Security alert generated: [' || NEW.severity || '] ' || NEW.title;
        ELSIF TG_OP = 'UPDATE' THEN
            IF NEW.is_resolved AND NOT OLD.is_resolved THEN
                v_description := 'Alert resolved: ' || NEW.title;
            ELSE
                v_description := 'Alert metadata updated: ' || NEW.title;
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'shift_closures' THEN
        IF TG_OP = 'INSERT' THEN
            v_description := 'Shift closure recorded for tank ' || COALESCE((SELECT tank_name FROM tanks WHERE id = NEW.tank_id), 'Unknown');
        ELSE
            v_description := 'Shift record ' || TG_OP || 'ed by operator.';
        END IF;
    ELSIF TG_TABLE_NAME = 'current_station_shifts' THEN
        v_description := 'Station shift status changed to ' || NEW.status;
    ELSE
        v_description := 'Forensic audit: ' || TG_OP || ' on ' || TG_TABLE_NAME;
    END IF;

    -- Attempt to get actor name
    SELECT display_name INTO v_actor_name FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

    -- [INTELLIGENCE]: Map severity from source if available
    IF TG_TABLE_NAME = 'alerts' THEN
        v_severity := UPPER(COALESCE(NEW.severity, 'INFO'));
    ELSIF v_category = 'SECURITY' THEN
        v_severity := 'CRITICAL';
    ELSE
        v_severity := 'INFO';
    END IF;

    INSERT INTO public.unified_events (
        station_id, 
        event_category, 
        event_type, 
        description, 
        actor_id, 
        actor_email, 
        actor_name, 
        metadata,
        severity
    )
    VALUES (
        v_station_id, 
        v_category, 
        TG_TABLE_NAME || '_' || TG_OP,
        v_description,
        auth.uid(), 
        auth.jwt()->>'email', 
        COALESCE(v_actor_name, auth.jwt()->>'email', 'SYSTEM'),
        jsonb_build_object(
            'old', to_jsonb(OLD), 
            'new', to_jsonb(NEW),
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'timestamp', now()
        ),
        v_severity
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;
