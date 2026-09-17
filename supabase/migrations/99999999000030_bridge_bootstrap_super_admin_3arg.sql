-- Bridge: fix bootstrap_super_admin signature to match the app's 3-arg call.

DROP FUNCTION IF EXISTS public.bootstrap_super_admin();

CREATE OR REPLACE FUNCTION public.bootstrap_super_admin(
    p_auth_user_id UUID,
    p_email        TEXT,
    p_full_name    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.system_users
        WHERE role = 'super_admin' AND is_active = TRUE
    ) AND NOT public.check_is_super_admin() THEN
        RAISE EXCEPTION 'A super admin already exists; bootstrap denied';
    END IF;

    INSERT INTO public.system_users (
        auth_user_id, email, display_name, role, is_active
    ) VALUES (
        p_auth_user_id, p_email, COALESCE(p_full_name, split_part(p_email, '@', 1)),
        'super_admin', TRUE
    )
    ON CONFLICT (email) DO UPDATE
        SET auth_user_id = EXCLUDED.auth_user_id,
            role         = EXCLUDED.role,
            is_active    = TRUE,
            display_name = COALESCE(EXCLUDED.display_name, public.system_users.display_name);

    RETURN jsonb_build_object('success', true, 'email', p_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin(uuid, text, text) TO anon;
