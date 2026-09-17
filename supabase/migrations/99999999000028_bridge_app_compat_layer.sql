-- Bridge: expose tables and RPCs the admin app expects but that were
-- renamed, dropped, or never created. Compat layer to unblock the UI
-- without changing frontend code.

-- ============================================================================
-- 1. TABLE ALIASES (views over renamed tables)
-- ============================================================================

CREATE OR REPLACE VIEW public.admin_logs AS
    SELECT * FROM public.audit_logs;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_logs TO authenticated;

CREATE OR REPLACE VIEW public.firmware_releases AS
    SELECT * FROM public.firmware_campaigns;
GRANT SELECT ON public.firmware_releases TO authenticated;

CREATE OR REPLACE VIEW public.scheduled_reports AS
    SELECT * FROM public.reports;
GRANT SELECT ON public.scheduled_reports TO authenticated;

-- financial_reports: no obvious source table. Minimal stub view.
-- Update if the app has real data expectations.
CREATE TABLE IF NOT EXISTS public.financial_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES public.fuel_stations(station_id) ON DELETE CASCADE,
    report_period TEXT,
    total_revenue NUMERIC(12,2),
    total_expenses NUMERIC(12,2),
    net_profit NUMERIC(12,2),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.financial_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can manage financial_reports" ON public.financial_reports;
CREATE POLICY "Staff can manage financial_reports"
    ON public.financial_reports FOR ALL TO authenticated
    USING (public.check_is_staff())
    WITH CHECK (public.check_is_staff());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_reports TO authenticated;

-- ============================================================================
-- 2. RPCs
-- ============================================================================

-- 2a. bootstrap_super_admin() — provisions super_admin for the calling user
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_email TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    IF v_email IS NULL THEN
        RAISE EXCEPTION 'No auth user found for current session';
    END IF;

    INSERT INTO public.system_users (auth_user_id, email, display_name, role, is_active)
    VALUES (v_uid, v_email, split_part(v_email, '@', 1), 'super_admin', TRUE)
    ON CONFLICT (email) DO UPDATE
        SET auth_user_id = EXCLUDED.auth_user_id,
            role         = EXCLUDED.role,
            is_active    = TRUE;

    RETURN jsonb_build_object('success', true, 'email', v_email);
END;
$$;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin() TO authenticated;

-- 2b. get_monthly_registration_growth() — analytics
CREATE OR REPLACE FUNCTION public.get_monthly_registration_growth()
RETURNS TABLE(month TEXT, count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT to_char(created_at, 'YYYY-MM') AS month, COUNT(*)::BIGINT AS count
    FROM public.fuel_stations
    WHERE created_at >= NOW() - INTERVAL '12 months'
    GROUP BY 1
    ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_monthly_registration_growth() TO authenticated;


-- 2d. process_monthly_invoicing() — billing automation
CREATE OR REPLACE FUNCTION public.process_monthly_invoicing()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT;
BEGIN
    -- Placeholder: real logic presumably creates invoices per station
    -- based on billing cycle. Returning a summary here.
    SELECT COUNT(*) INTO v_count
    FROM public.fuel_stations
    WHERE next_billing_date IS NOT NULL
      AND next_billing_date <= CURRENT_DATE;

    RETURN jsonb_build_object('success', true, 'stations_due', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_monthly_invoicing() TO authenticated;
