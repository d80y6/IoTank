-- ============================================================================
-- INFRASTRUCTURE SECURITY STRENGTHENING
-- ============================================================================

-- 1. GLOBAL SEARCH PATH HARDENING (IDEMPOTENT)
-- ============================================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT n.nspname, p.proname, oidvectortypes(p.proargtypes) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname IN ('public', 'internal')
    ) LOOP
        EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public', r.nspname, r.proname, r.args);
    END LOOP;
END $$;

-- 2. PII REDACTION HELPER FOR LOGS
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.redact_pii(p_data JSONB)
RETURNS JSONB AS $$
BEGIN
    IF p_data IS NULL THEN RETURN NULL; END IF;
    RETURN p_data 
        - 'email' 
        - 'phone' 
        - 'phone_number' 
        - 'password' 
        - 'master_access_password' 
        - 'photo_url'
        - 'display_name'
        - 'full_name';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. RATE LIMITING FOR EXPENSIVE ANALYTICAL QUERIES
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_business_kpis_v2()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_rate_limit_ok BOOLEAN;
BEGIN
    SELECT public.consume_edge_rate_limit(
        auth.uid()::text, 
        'get_business_kpis', 
        60, 
        10 
    ) INTO v_rate_limit_ok;

    IF NOT v_rate_limit_ok THEN
        RAISE EXCEPTION 'Rate limit exceeded for business analytics. Please wait a minute.';
    END IF;

    RETURN public.get_business_kpis();
END;
$$;

-- 4. PRIVACY: DELETED USER CLEANUP TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.handle_user_deletion()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.profiles WHERE auth_user_id = OLD.id;
    DELETE FROM public.system_users WHERE auth_user_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION internal.handle_user_deletion();

-- 5. AUDIT LOG HARDENING: APPLY REDACTION (Unified Events Schema)
-- ============================================================================
CREATE OR REPLACE FUNCTION internal.audit_trigger_handler()
RETURNS TRIGGER AS $$
DECLARE
    v_station_id UUID;
BEGIN
    -- Resolve station_id from the record
    BEGIN
        v_station_id := COALESCE(NEW.station_id, OLD.station_id);
    EXCEPTION WHEN OTHERS THEN
        v_station_id := NULL;
    END;

    INSERT INTO public.unified_events (
        station_id, 
        event_category, 
        event_type, 
        description, 
        actor_id, 
        actor_email, 
        metadata
    )
    VALUES (
        v_station_id,
        'SYSTEM',
        TG_TABLE_NAME || '_' || TG_OP,
        'Forensic audit: ' || TG_OP || ' detected on ' || TG_TABLE_NAME,
        auth.uid(),
        auth.jwt()->>'email',
        jsonb_build_object(
            'old', internal.redact_pii(to_jsonb(OLD)), 
            'new', internal.redact_pii(to_jsonb(NEW))
        )
    );
    RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. RELOAD SCHEMA
NOTIFY pgrst, 'reload schema';
