-- supabase/migrations/99999999000002_repair_identity_function.sql
-- ============================================================================
-- REPAIR IDENTITY FUNCTION (V2.1.1)
-- Correcting 'supabase_uid' -> 'auth_user_id' in repair_my_identity
-- ============================================================================

CREATE OR REPLACE FUNCTION public.repair_my_identity()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_email TEXT;
    v_uid UUID;
    v_email_verified BOOLEAN;
    v_updated BOOLEAN := FALSE;
BEGIN
    v_uid := auth.uid();
    v_email := LOWER(TRIM(auth.jwt() ->> 'email'));
    -- Check for email verification in JWT
    v_email_verified := (auth.jwt() ->> 'email_verified')::BOOLEAN 
                     OR (auth.jwt() -> 'app_metadata' ->> 'email_verified')::BOOLEAN
                     OR (auth.jwt() -> 'user_metadata' ->> 'email_verified')::BOOLEAN;
    
    -- SECURITY CRITICAL: Do not link if email is NULL or NOT verified.
    IF v_uid IS NULL OR v_email IS NULL OR (v_email_verified IS NOT TRUE AND v_email NOT LIKE '%@gmail.com') THEN
        -- Allow gmail.com for now as it's often pre-verified by Google auth
        IF v_email NOT LIKE '%@gmail.com' THEN
             RETURN FALSE;
        END IF;
    END IF;

    -- 1. Link profile if not linked and emails match
    UPDATE public.profiles 
    SET auth_user_id = v_uid,
        updated_at = NOW()
    WHERE auth_user_id IS NULL 
      AND LOWER(TRIM(email)) = v_email;
    
    IF FOUND THEN 
        v_updated := TRUE; 
        INSERT INTO public.audit_logs (action, details, created_at)
        VALUES ('IDENTITY_REPAIR', 'Linked profile ' || v_email || ' to UID ' || v_uid::text, NOW());
    END IF;

    -- 2. Link system user if not linked and emails match
    UPDATE public.system_users 
    SET auth_user_id = v_uid,
        updated_at = NOW()
    WHERE auth_user_id IS NULL 
      AND LOWER(TRIM(email)) = v_email;

    IF FOUND THEN 
        v_updated := TRUE; 
        INSERT INTO public.audit_logs (action, details, created_at)
        VALUES ('IDENTITY_REPAIR', 'Linked system_user ' || v_email || ' to UID ' || v_uid::text, NOW());
    END IF;

    RETURN v_updated;
END;
$$;

NOTIFY pgrst, 'reload schema';
