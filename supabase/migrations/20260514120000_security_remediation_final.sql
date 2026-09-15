-- supabase/migrations/20260514120000_security_remediation_final.sql
-- ============================================================================
-- SECURITY REMEDIATION: Hardening SECURITY DEFINER functions & RLS Stability
-- Addresses Supabase Linter Warnings: 0028 (anon) and 0029 (authenticated)
-- ============================================================================

-- 1. USER_PREFERENCES: Fix RLS Policy (Addresses RLS Violation)
-- ============================================================================
-- The previous policy used non-existent columns (supabase_uid, id) 
-- due to the 'definitive_identity_fix' rename.
-- ============================================================================
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own preferences" ON public.user_preferences;

CREATE POLICY "Users manage own preferences"
ON public.user_preferences FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());


-- 2. HARDEN FUNCTIONS: Add search_path and Revoke Public Execute
-- ============================================================================
-- We revoke EXECUTE from PUBLIC by default and only grant to necessary roles.
-- ============================================================================

-- helper to safely update functions
DO $$
DECLARE
    f RECORD;
BEGIN
    -- For each function in the user's linter list, we ensure search_path is set
    -- and execute is revoked from public.
    
    -- Note: We only target functions that are SECURITY DEFINER.
    FOR f IN (
        SELECT 
            proname, 
            oidvectortypes(proargtypes) as args,
            nspname as schema
        FROM pg_proc 
        JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid 
        WHERE nspname = 'public' 
        AND prosecdef = true -- Only SECURITY DEFINER
        AND proname IN (
            'log_auth_attempt', 'log_registration_event', 'update_tank_from_sensor',
            'check_is_staff', 'check_is_super_admin', 'check_my_identity',
            'delete_user_safely', 'get_admin_dashboard_stats', 'get_admin_risk_matrix',
            'get_auth_user_id_by_email', 'get_my_station_id', 'get_station_dashboard_summary',
            'get_tankiq_audit_logs', 'get_tankiq_financial_status', 'get_tankiq_hardware_health',
            'get_tankiq_shift_analytics', 'get_tankiq_station_summary', 'get_tankiq_support_summary',
            'get_tankiq_usage_insights', 'get_user_bundle_v2', 'is_system_admin',
            'process_payment', 'repair_my_identity', 'upsert_alert_v2'
        )
    ) LOOP
        -- Set search_path = public to prevent injection
        EXECUTE 'ALTER FUNCTION public.' || quote_ident(f.proname) || '(' || f.args || ') SET search_path = public';
        
        -- Revoke from PUBLIC
        EXECUTE 'REVOKE EXECUTE ON FUNCTION public.' || quote_ident(f.proname) || '(' || f.args || ') FROM PUBLIC';
    END LOOP;
END $$;


-- 3. GRANT PERMISSIONS: Explicitly grant to authenticated/anon
-- ============================================================================

-- A. Functions allowed for ANONYMOUS (Public RPCs)
GRANT EXECUTE ON FUNCTION public.log_auth_attempt(p_email text, p_is_success boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_auth_attempt(p_email text, p_success boolean, p_ip text, p_user_agent text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_registration_event(p_registration_id uuid, p_event_type text, p_actor_email text, p_notes text, p_detail_json jsonb) TO anon, authenticated;

-- B. Functions allowed for AUTHENTICATED (Private RPCs)
GRANT EXECUTE ON FUNCTION public.check_is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_my_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_safely(target_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_risk_matrix() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(p_email text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_station_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_station_dashboard_summary(p_station_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_audit_logs(p_station_id uuid, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_financial_status(p_station_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_hardware_health(p_station_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_shift_analytics(p_station_id uuid, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_station_summary(p_station_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_support_summary(p_station_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_usage_insights(p_station_id uuid, p_days integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_bundle_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_system_admin(minimum_level integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_system_admin(minimum_role text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_payment(p_station_id uuid, p_amount numeric, p_payment_method text, p_payment_reference text, p_description text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_my_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_alert_v2(p_station_id uuid, p_tank_id uuid, p_alert_type text, p_message text, p_severity text, p_metadata jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_alert_v2(p_station_id uuid, p_tank_id uuid, p_alert_type text, p_title text, p_message text, p_severity text, p_metadata jsonb) TO authenticated;

-- C. Functions restricted to SERVICE_ROLE ONLY (Trigger Functions)
-- No explicit grant for authenticated/anon means they are only callable by postgres/service_role
-- Targeting: update_tank_from_sensor

-- 4. FIX user_preferences FK Mismatch and Profiles PK Unification
-- ============================================================================
DO $$ 
BEGIN
    -- Only proceed if both 'id' and 'auth_user_id' exist (indicating a legacy state)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'id') 
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'auth_user_id') THEN
        
        RAISE NOTICE 'Unifying Profiles identity and fixing user_preferences FK...';

        -- 1. Drop the FK from user_preferences to profiles(id)
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'user_preferences_user_id_fkey') THEN
            ALTER TABLE public.user_preferences DROP CONSTRAINT user_preferences_user_id_fkey;
        END IF;

        -- 2. Data Migration: Update user_preferences to use actual Supabase UIDs
        UPDATE public.user_preferences up
        SET user_id = p.auth_user_id
        FROM public.profiles p
        WHERE up.user_id = p.id
          AND p.auth_user_id IS NOT NULL;

        -- 3. Profiles: Swap PK from 'id' (random) to 'auth_user_id' (Supabase UID)
        -- CASCADE handles any other internal constraints
        ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_pkey CASCADE;
        ALTER TABLE public.profiles ADD PRIMARY KEY (auth_user_id);

        -- 4. Clean up: Drop the redundant random 'id' column
        ALTER TABLE public.profiles DROP COLUMN id;

        -- 5. Restore FK: user_preferences now correctly points to the identity column
        ALTER TABLE public.user_preferences 
            ADD CONSTRAINT user_preferences_user_id_fkey 
            FOREIGN KEY (user_id) REFERENCES public.profiles(auth_user_id) ON DELETE CASCADE;

        RAISE NOTICE 'Profiles identity unification complete.';
    END IF;
END $$;


-- 5. HOUSEKEEPING: Reload schema
NOTIFY pgrst, 'reload schema';
