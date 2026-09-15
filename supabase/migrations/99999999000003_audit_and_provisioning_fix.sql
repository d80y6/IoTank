-- supabase/migrations/99999999000003_audit_and_provisioning_fix.sql
-- ============================================================================
-- AUDIT & PROVISIONING REMEDIATION (V2.2.0)
-- 1. Fix unified_events schema (Add severity)
-- 2. Fix get_auth_user_id_by_email permissions
-- 3. Implement get_admin_risk_matrix
-- ============================================================================

-- STEP 1: Fix unified_events schema
-- ============================================================================
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'unified_events' AND column_name = 'severity') THEN
        ALTER TABLE public.unified_events ADD COLUMN severity TEXT DEFAULT 'INFO';
    END IF;
END $$;

-- STEP 2: Harden get_auth_user_id_by_email
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  RETURN (SELECT id FROM auth.users WHERE email = p_email LIMIT 1);
END;
$$;

-- STEP 3: Implement get_admin_risk_matrix
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_risk_matrix()
RETURNS TABLE (
    actor_uid UUID,
    actor_email TEXT,
    high_risk_actions BIGINT,
    security_alerts BIGINT,
    risk_score FLOAT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.auth_user_id as actor_uid,
        u.email as actor_email,
        COUNT(e.id) FILTER (WHERE e.severity = 'CRITICAL') as high_risk_actions,
        COUNT(e.id) FILTER (WHERE e.event_category = 'SECURITY') as security_alerts,
        (COUNT(e.id) FILTER (WHERE e.severity = 'CRITICAL') * 10 + 
         COUNT(e.id) FILTER (WHERE e.event_category = 'SECURITY') * 5)::FLOAT as risk_score
    FROM public.system_users u
    LEFT JOIN public.unified_events e ON e.actor_id = u.auth_user_id
    GROUP BY u.auth_user_id, u.email;
END;
$$;

-- STEP 4: GRANT Permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_admin_risk_matrix() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) TO authenticated;

-- RELOAD PostgREST
NOTIFY pgrst, 'reload schema';
