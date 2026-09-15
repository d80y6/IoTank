-- ============================================================================
-- STRICT FINAL HARDENING & RECURSION PREVENTION
-- ============================================================================

-- 1. FIX: PREVENT POLICY RECURSION
-- ============================================================================

CREATE OR REPLACE FUNCTION internal.check_is_admin_internal(p_uid UUID, p_min_level TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    v_role TEXT;
    v_active BOOLEAN;
    v_role_order INTEGER;
    v_req_order INTEGER;
BEGIN
    SELECT role, is_active INTO v_role, v_active
    FROM public.system_users
    WHERE supabase_uid = p_uid;

    IF NOT FOUND OR NOT v_active THEN RETURN FALSE; END IF;
    IF p_min_level IS NULL THEN RETURN TRUE; END IF;

    v_role_order := CASE v_role
        WHEN 'super_admin'   THEN 1
        WHEN 'admin_helper'  THEN 2
        WHEN 'support_staff' THEN 3
        WHEN 'analyst'       THEN 4
        ELSE 99
    END;

    v_req_order := CASE p_min_level
        WHEN 'super_admin'   THEN 1
        WHEN 'admin_helper'  THEN 2
        WHEN 'support_staff' THEN 3
        WHEN 'analyst'       THEN 4
        ELSE 99
    END;

    RETURN v_role_order <= v_req_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Overload 1: Text
CREATE OR REPLACE FUNCTION public.is_system_admin(minimum_role text DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN internal.check_is_admin_internal(auth.uid(), minimum_role);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Overload 2: Integer
CREATE OR REPLACE FUNCTION public.is_system_admin(minimum_level integer)
RETURNS BOOLEAN AS $$
DECLARE
    v_min_role TEXT;
BEGIN
    v_min_role := CASE minimum_level
        WHEN 1 THEN 'super_admin'
        WHEN 2 THEN 'admin_helper'
        WHEN 3 THEN 'support_staff'
        WHEN 4 THEN 'analyst'
        ELSE NULL
    END;
    RETURN internal.check_is_admin_internal(auth.uid(), v_min_role);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Redefine is_admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN internal.check_is_admin_internal(auth.uid(), 'super_admin');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- 2. AUTOMATION: SCHEDULE ANALYTICS REFRESH
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-analytics-hourly') THEN
            PERFORM cron.unschedule('refresh-analytics-hourly');
        END IF;
        
        PERFORM cron.schedule(
            'refresh-analytics-hourly',
            '0 * * * *',
            'SELECT public.refresh_tank_analytics()'
        );
    END IF;
END $$;

-- 3. FINANCIAL AUDIT: EXTEND LOGGING (IDEMPOTENT)
-- ============================================================================
DO $$
BEGIN
    -- transactions (Table exists in current schema)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions') THEN
        DROP TRIGGER IF EXISTS audit_transactions ON public.transactions;
        CREATE TRIGGER audit_transactions
            AFTER INSERT OR UPDATE OR DELETE ON public.transactions
            FOR EACH ROW EXECUTE FUNCTION internal.audit_trigger_handler();
    END IF;

    -- usage_logs (DROPPED in previous migrations, but we check just in case)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'usage_logs') THEN
        DROP TRIGGER IF EXISTS audit_usage_logs ON public.usage_logs;
        CREATE TRIGGER audit_usage_logs
            AFTER INSERT OR UPDATE OR DELETE ON public.usage_logs
            FOR EACH ROW EXECUTE FUNCTION internal.audit_trigger_handler();
    END IF;
END $$;

-- 4. HARDEN POSTGREST EXPOSURE
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'tank_analytics_30d') THEN
        REVOKE ALL ON public.tank_analytics_30d FROM anon, authenticated;
    END IF;
END $$;

-- 5. PERFORMANCE: MISSION CRITICAL INDEXES (Corrected for Unified Events)
-- ============================================================================
-- The column names in unified_events are actor_id and event_type
CREATE INDEX IF NOT EXISTS idx_unified_events_type_created ON public.unified_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_events_actor_time ON public.unified_events(actor_id, created_at DESC);

-- 6. RELOAD
NOTIFY pgrst, 'reload schema';
