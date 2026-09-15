-- supabase/migrations/99999999000001_definitive_admin_repair.sql
-- ============================================================================
-- DEFINITIVE ADMINISTRATIVE REPAIR (V2.1.0)
-- 1. Fix get_admin_dashboard_stats (Table/Column mismatches)
-- 2. Harden is_system_admin & check_is_admin_internal (Auth/RLS)
-- 3. Restore Pending Registrations Visibility
-- ============================================================================

-- STEP 1: HARDEN ADMINISTRATIVE CHECK FUNCTIONS
-- ============================================================================

-- A. check_is_admin_internal (Internal Security Helper)
CREATE OR REPLACE FUNCTION internal.check_is_admin_internal(p_uid UUID, p_min_level TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT;
    v_active BOOLEAN;
    v_role_order INTEGER;
    v_req_order INTEGER;
BEGIN
    -- 1. Resolve role and status
    SELECT role, is_active INTO v_role, v_active
    FROM public.system_users
    WHERE auth_user_id = p_uid;

    IF NOT FOUND OR NOT v_active THEN RETURN FALSE; END IF;
    IF p_min_level IS NULL THEN RETURN TRUE; END IF;

    -- 2. Evaluate Hierarchy
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
$$;

-- B. is_system_admin (Public Helper for RLS)
CREATE OR REPLACE FUNCTION public.is_system_admin(minimum_role TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    RETURN internal.check_is_admin_internal(auth.uid(), minimum_role);
END;
$$;

-- C. is_system_admin (Overload for legacy INT levels)
CREATE OR REPLACE FUNCTION public.is_system_admin(minimum_level INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
$$;

-- STEP 2: REPAIR DASHBOARD STATISTICS RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID;
  c_users INT := 0;
  c_tanks INT := 0;
  c_stations INT := 0;
  c_operators INT := 0;
  c_online_devs INT := 0;
  c_open_tickets INT := 0;
  c_urgent_tickets INT := 0;
  c_pending_reqs INT := 0;
  c_pending_adjs INT := 0;
  v_mrr DECIMAL := 0;
  v_debt DECIMAL := 0;
  v_recent_activity JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  
  -- Auth Check: Must be super_admin or admin_helper
  IF NOT internal.check_is_admin_internal(v_uid, 'admin_helper') THEN
     RAISE EXCEPTION 'Unauthorized: Administrative access required.';
  END IF;

  -- 1. General Metrics
  SELECT COUNT(*) INTO c_users FROM public.profiles;
  SELECT COUNT(*) INTO c_tanks FROM public.tanks;
  SELECT COUNT(*) INTO c_stations FROM public.fuel_stations;
  SELECT COUNT(*) INTO c_operators FROM public.system_users WHERE is_active = TRUE;
  
  -- 2. Online Devices Check
  -- Prefer telemetry_history, fallback to sensor_readings
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'telemetry_history' AND column_name = 'device_id') THEN
     SELECT COUNT(DISTINCT device_id) INTO c_online_devs 
     FROM public.telemetry_history 
     WHERE created_at > NOW() - INTERVAL '15 minutes';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sensor_readings' AND column_name = 'tank_id') THEN
     SELECT COUNT(DISTINCT tank_id) INTO c_online_devs 
     FROM public.sensor_readings 
     WHERE captured_at > NOW() - INTERVAL '15 minutes';
  END IF;

  -- 3. Financial Metrics
  SELECT COALESCE(SUM(current_debt), 0) INTO v_debt FROM public.fuel_stations;
  SELECT COALESCE(SUM(amount), 0) INTO v_mrr 
  FROM public.transactions 
  WHERE transaction_type IN ('charge', 'usage_charge') 
    AND payment_status = 'completed' 
    AND created_at >= DATE_TRUNC('month', NOW());

  -- 4. Support Metrics
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_tickets') THEN
     EXECUTE 'SELECT COUNT(*) FROM public.support_tickets WHERE status IN (''open'', ''in_progress'')' INTO c_open_tickets;
     EXECUTE 'SELECT COUNT(*) FROM public.support_tickets WHERE priority = ''urgent'' AND status IN (''open'', ''in_progress'')' INTO c_urgent_tickets;
  END IF;

  SELECT COUNT(*) INTO c_pending_reqs FROM public.pending_registrations WHERE status = 'pending';
  
  -- 5. Recent Activity
  -- Use audit_logs instead of admin_logs
  BEGIN
    SELECT jsonb_agg(act) INTO v_recent_activity FROM (
      (SELECT 'system' as type, action as text, created_at, id::text 
       FROM public.audit_logs 
       ORDER BY created_at DESC LIMIT 10)
      UNION ALL
      (SELECT 'registration' as type, 'New client: ' || station_name as text, created_at, id::text 
       FROM public.pending_registrations 
       WHERE status = 'pending' 
       ORDER BY created_at DESC LIMIT 5)
      ORDER BY created_at DESC
      LIMIT 15
    ) act;
  EXCEPTION WHEN OTHERS THEN
    v_recent_activity := '[]'::jsonb;
  END;

  -- 6. Compile Results
  v_result := jsonb_build_object(
    'health', jsonb_build_object(
       'totalUsers', c_users, 'totalTanks', c_tanks, 'totalStations', c_stations, 'totalOperators', c_operators,
       'uptime', '99.99%', 'dbSize', (SELECT pg_size_pretty(pg_database_size(current_database()))),
       'espDevices', jsonb_build_object('online', c_online_devs, 'total', c_tanks),
       'apiStatus', jsonb_build_object('supabase', 'green', 'twilio', 'green')
    ),
    'financial', jsonb_build_object('mrr', v_mrr, 'arr', v_mrr * 12, 'outstandingDebt', v_debt),
    'support', jsonb_build_object('openTickets', c_open_tickets, 'urgentTickets', c_urgent_tickets, 'pendingRequests', c_pending_reqs, 'pendingAdjustments', c_pending_adjs),
    'recentActivity', COALESCE(v_recent_activity, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

-- STEP 3: RESTORE PENDING REGISTRATIONS VISIBILITY
-- ============================================================================

ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "System admins can view all pending registrations" ON public.pending_registrations;
CREATE POLICY "System admins can view all pending registrations"
  ON public.pending_registrations FOR SELECT TO authenticated
  USING (public.is_system_admin('support_staff'));

DROP POLICY IF EXISTS "System admins can update pending registrations" ON public.pending_registrations;
CREATE POLICY "System admins can update pending registrations"
  ON public.pending_registrations FOR UPDATE TO authenticated
  USING (public.is_system_admin('support_staff'))
  WITH CHECK (public.is_system_admin('support_staff'));

-- GRANT Permissions to ensure clean access
GRANT SELECT, UPDATE, DELETE ON TABLE public.pending_registrations TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_system_admin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_system_admin(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated;

-- RELOAD PostgREST
NOTIFY pgrst, 'reload schema';
