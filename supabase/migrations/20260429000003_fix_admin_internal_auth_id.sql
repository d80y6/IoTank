-- supabase/migrations/20260429000003_fix_admin_internal_auth_id.sql
-- ============================================================================
-- FIX: internal.check_is_admin_internal column name mismatch
--
-- The previous strict hardening migration accidentally referenced the legacy
-- 'supabase_uid' column instead of the standardized 'auth_user_id' column,
-- causing all RLS policies relying on this admin override to fail with:
-- "column 'supabase_uid' does not exist"
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
    WHERE auth_user_id = p_uid;

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

-- Reload schema to apply function definitions
NOTIFY pgrst, 'reload schema';
