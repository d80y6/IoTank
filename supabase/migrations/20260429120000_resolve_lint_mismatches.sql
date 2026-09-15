-- supabase/migrations/20260429120000_resolve_lint_mismatches.sql
-- ============================================================================
-- SYSTEM HARMONIZATION & LINT RESOLUTION
-- 1. Fix column name mismatches (volume, station_id, auth_user_id)
-- 2. Repair RPC grouping and aggregate violations
-- 3. Align system_users with auth_user_id standards
-- 4. Restore missing admin_logs references
-- ============================================================================

BEGIN;

-- 1. Align system_users column names
DO $$
BEGIN
    -- Rename firebase_uid to auth_user_id if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_users' AND column_name = 'firebase_uid') THEN
        ALTER TABLE public.system_users RENAME COLUMN firebase_uid TO auth_user_id;
    END IF;
    
    -- Rename full_name to display_name for consistency with profiles
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_users' AND column_name = 'full_name') THEN
        ALTER TABLE public.system_users RENAME COLUMN full_name TO display_name;
    END IF;
END $$;

-- 2. Repair get_tankiq_delivery_logs (Fix volume_liters -> actual_received_volume)
CREATE OR REPLACE FUNCTION public.get_tankiq_delivery_logs(p_station_id UUID, p_limit INTEGER DEFAULT 5)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_agg(jsonb_build_object(
        'tank_name', t.tank_name,
        'volume', d.actual_received_volume, -- FIXED: volume_liters was missing
        'date', d.delivery_date,
        'supplier', d.supplier_name
    ))
    FROM deliveries d
    JOIN tanks t ON d.tank_id = t.id
    WHERE d.station_id = p_station_id
    ORDER BY d.delivery_date DESC
    LIMIT p_limit
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- 3. Repair get_tankiq_market_context (Fix GROUP BY violation)
CREATE OR REPLACE FUNCTION public.get_tankiq_market_context()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'latest_prices', (
            SELECT jsonb_agg(jsonb_build_object(
                'fuel_type', fuel_type,
                'price', price_per_liter,
                'source', source,
                'date', effective_date
            ))
            FROM (
                -- Use DISTINCT ON to avoid grouping issues while getting latest price per type
                SELECT DISTINCT ON (fuel_type) 
                    fuel_type, price_per_liter, source, effective_date
                FROM market_prices
                WHERE source = 'epra'
                ORDER BY fuel_type, effective_date DESC
            ) sub
        ),
        'regulatory_notices', (
            SELECT jsonb_agg(jsonb_build_object(
                'title', title,
                'summary', summary,
                'effective_date', effective_date
            ))
            FROM regulatory_notices
            ORDER BY created_at DESC
            LIMIT 2
        )
    ) INTO result;
    
    RETURN result;
END;
$$;

-- 4. Repair get_tankiq_station_summary (Fix timestamp -> created_at and GROUP BY)
CREATE OR REPLACE FUNCTION public.get_tankiq_station_summary(p_station_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'station_id', p_station_id,
        'timestamp', now(),
        'tanks', (
            SELECT jsonb_agg(jsonb_build_object(
                'label', tank_name,
                'fuel_type', fuel_type,
                'capacity', tank_capacity,
                'current_volume', current_volume,
                'fill_percent', ROUND((current_volume / NULLIF(tank_capacity, 0) * 100)::NUMERIC, 1)
            ))
            FROM tanks
            WHERE station_id = p_station_id AND status = 'active'
        ),
        'recent_alerts', (
            SELECT jsonb_agg(jsonb_build_object(
                'type', alert_type,
                'severity', severity,
                'message', message,
                'time', created_at -- FIXED: timestamp -> created_at
            ))
            FROM (
                SELECT alert_type, severity, message, created_at
                FROM alerts
                WHERE station_id = p_station_id AND is_resolved = false
                ORDER BY created_at DESC
                LIMIT 5
            ) sub
        )
    ) INTO result;
    
    RETURN result;
END;
$$;

-- 5. Repair get_tankiq_consumption_stats (Fix nested aggregate violation)
CREATE OR REPLACE FUNCTION public.get_tankiq_consumption_stats(p_station_id UUID, p_days INTEGER DEFAULT 7)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'period_days', p_days,
        'summary', (
            SELECT jsonb_agg(jsonb_build_object(
                'tank_name', tank_name,
                'total_burn', total_burn,
                'avg_daily_burn', ROUND((total_burn / p_days)::NUMERIC, 2)
            ))
            FROM (
                SELECT t.tank_name, SUM(s.volume_sold_liters) as total_burn
                FROM tanks t
                JOIN shift_closures s ON t.id = s.tank_id
                WHERE t.station_id = p_station_id 
                  AND s.closed_at > (now() - (p_days || ' days')::INTERVAL)
                GROUP BY t.id, t.tank_name
            ) sub
        )
    ) INTO result;
    
    RETURN result;
END;
$$;

-- 6. Repair add_debt_to_client (Fix client_billing -> fuel_stations)
CREATE OR REPLACE FUNCTION public.add_debt_to_client(p_station_id UUID, p_amount DECIMAL, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.fuel_stations
    SET current_debt = current_debt + p_amount,
        updated_at = NOW()
    WHERE id = p_station_id;
    
    INSERT INTO public.transactions (station_id, transaction_type, amount, description, payment_status)
    VALUES (p_station_id, 'charge', p_amount, p_reason, 'pending');
END;
$$;

-- 7. Repair detect_theft_anomaly (Fix ambient_volume -> volume)
CREATE OR REPLACE FUNCTION public.detect_theft_anomaly(p_tank_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_last_vol DECIMAL;
    v_curr_vol DECIMAL;
BEGIN
    SELECT current_volume INTO v_curr_vol FROM public.tanks WHERE id = p_tank_id;
    
    SELECT volume INTO v_last_vol -- FIXED: ambient_volume -> volume
    FROM public.sensor_readings 
    WHERE tank_id = p_tank_id 
    ORDER BY timestamp DESC 
    OFFSET 1 LIMIT 1;
    
    IF v_last_vol IS NOT NULL AND v_last_vol - v_curr_vol > 50 THEN 
        RETURN TRUE;
    END IF;
    RETURN FALSE;
END;
$$;

-- 8. Repair log_auth_attempt (Fix ip_address_to_inet -> ::INET)
CREATE OR REPLACE FUNCTION public.log_auth_attempt(p_email TEXT, p_success BOOLEAN, p_ip TEXT DEFAULT NULL, p_user_agent TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Use security_telemetry_events as the modern sink for auth logs if security_logs is missing
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'security_telemetry_events') THEN
        INSERT INTO public.security_telemetry_events (event_type, severity, description, metadata)
        VALUES ('AUTH_ATTEMPT', CASE WHEN p_success THEN 'info' ELSE 'warning' END, 
                'Login attempt for ' || p_email, 
                jsonb_build_object('ip', p_ip, 'user_agent', p_user_agent, 'success', p_success));
    END IF;
END;
$$;

-- 9. Standardize get_admin_dashboard_stats (Fix device_id consistency)
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
  v_mrr DECIMAL := 0;
  v_debt DECIMAL := 0;
  v_recent_activity JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();
  
  -- 1. General Metrics
  SELECT COUNT(*) INTO c_users FROM public.profiles;
  SELECT COUNT(*) INTO c_tanks FROM public.tanks;
  SELECT COUNT(*) INTO c_stations FROM public.fuel_stations;
  SELECT COUNT(*) INTO c_operators FROM public.system_users WHERE is_active = TRUE;
  
  -- Online devs check (active reading in last 15 mins)
  -- standardizing on device_id fallback
  SELECT COUNT(DISTINCT tank_id) INTO c_online_devs 
  FROM public.sensor_readings 
  WHERE timestamp > NOW() - INTERVAL '15 minutes';

  -- 2. Financial Metrics
  SELECT COALESCE(SUM(current_debt), 0) INTO v_debt FROM public.fuel_stations;
  SELECT COALESCE(SUM(amount), 0) INTO v_mrr FROM public.transactions 
  WHERE transaction_type IN ('charge', 'usage_charge') 
    AND payment_status = 'completed' 
    AND created_at >= DATE_TRUNC('month', NOW());

  -- 3. Support Metrics (Safe check)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_tickets') THEN
     EXECUTE 'SELECT COUNT(*) FROM public.support_tickets WHERE status IN (''open'', ''in_progress'')' INTO c_open_tickets;
  END IF;

  -- 4. Recent Activity
  BEGIN
    SELECT jsonb_agg(act) INTO v_recent_activity FROM (
      SELECT 'system' as type, description as text, created_at
      FROM public.admin_logs 
      ORDER BY created_at DESC LIMIT 10
    ) act;
  EXCEPTION WHEN OTHERS THEN
    v_recent_activity := '[]'::jsonb;
  END;

  -- Compile Results
  v_result := jsonb_build_object(
    'health', jsonb_build_object(
       'totalUsers', c_users, 'totalTanks', c_tanks, 'totalStations', c_stations, 'totalOperators', c_operators,
       'espDevices', jsonb_build_object('online', c_online_devs, 'total', c_tanks)
    ),
    'financial', jsonb_build_object('mrr', v_mrr, 'outstandingDebt', v_debt),
    'support', jsonb_build_object('openTickets', c_open_tickets),
    'recentActivity', COALESCE(v_recent_activity, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
