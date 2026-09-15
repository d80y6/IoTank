-- supabase/migrations/20260513100000_tankiq_comprehensive_intelligence.sql

-- ============================================================================
-- 1. SCHEMA FIXES (CRITICAL)
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alerts' AND column_name = 'updated_at') THEN
        ALTER TABLE public.alerts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- ============================================================================
-- 2. TANKIQ OPERATIONAL INTELLIGENCE TOOLS (RPCs)
-- ============================================================================

-- A. Enhanced Station Summary (with metadata and security)
CREATE OR REPLACE FUNCTION public.get_tankiq_station_summary(p_station_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_build_object(
        'station_id', p_station_id,
        'station_name', fs.station_name,
        'station_location', fs.station_location,
        'county', fs.county,
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
                'time', created_at
            ))
            FROM (
                SELECT alert_type, severity, message, created_at
                FROM alerts
                WHERE station_id = p_station_id AND is_resolved = false
                ORDER BY created_at DESC
                LIMIT 5
            ) sub
        )
    ) INTO result
    FROM fuel_stations fs
    WHERE fs.station_id = p_station_id;
    
    RETURN result;
END;
$$;

-- B. Shift Analytics (Variances and Sales)
CREATE OR REPLACE FUNCTION public.get_tankiq_shift_analytics(p_station_id UUID, p_limit INTEGER DEFAULT 5)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'tank_name', t.tank_name,
        'closed_at', s.closed_at,
        'volume_sold', s.volume_sold_liters,
        'status', s.status,
        'variance', s.variance_data,
        'collections', s.received_collections
    ))
    FROM shift_closures s
    JOIN tanks t ON s.tank_id = t.id
    WHERE s.station_id = p_station_id
    ORDER BY s.closed_at DESC
    LIMIT p_limit
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- C. Financial Status (Debt and Invoices)
CREATE OR REPLACE FUNCTION public.get_tankiq_financial_status(p_station_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_build_object(
        'current_debt', fs.current_debt,
        'total_paid', fs.total_paid,
        'account_status', fs.status,
        'subscription_tier', fs.tier,
        'recent_invoices', (
            SELECT jsonb_agg(jsonb_build_object(
                'invoice_number', i.invoice_number,
                'amount', i.amount_due,
                'status', i.status,
                'due_date', i.due_date
            ))
            FROM invoices i
            WHERE i.station_id = p_station_id
            ORDER BY i.created_at DESC
            LIMIT 3
        )
    ) INTO result
    FROM fuel_stations fs
    WHERE fs.station_id = p_station_id;
    
    RETURN result;
END;
$$;

-- D. Hardware Health (Latest Telemetry Quality)
CREATE OR REPLACE FUNCTION public.get_tankiq_hardware_health(p_station_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'tank_name', t.tank_name,
        'sensor_id', t.sensor_id,
        'last_reading', t.last_reading_at,
        'signal_strength', r.rssi,
        'temperature', t.current_temperature,
        'status', t.status
    ))
    FROM tanks t
    LEFT JOIN LATERAL (
        SELECT rssi
        FROM sensor_readings
        WHERE tank_id = t.id
        ORDER BY timestamp DESC
        LIMIT 1
    ) r ON TRUE
    WHERE t.station_id = p_station_id
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- E. Forensic Audit Logs
CREATE OR REPLACE FUNCTION public.get_tankiq_audit_logs(p_station_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'category', event_category,
        'type', event_type,
        'description', description,
        'actor', actor_email,
        'time', created_at
    ))
    FROM (
        SELECT id, event_category, event_type, description, actor_email, created_at
        FROM unified_events
        WHERE station_id = p_station_id
        ORDER BY created_at DESC
        LIMIT p_limit
    ) sub
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- F. Support Ticket Summary
CREATE OR REPLACE FUNCTION public.get_tankiq_support_summary(p_station_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'subject', subject,
        'status', status,
        'priority', priority,
        'created_at', created_at
    ))
    FROM support_tickets
    WHERE station_id = p_station_id
    ORDER BY created_at DESC
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- G. Platform Usage Insights
CREATE OR REPLACE FUNCTION public.get_tankiq_usage_insights(p_station_id UUID, p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_auth_station_id UUID;
BEGIN
    v_auth_station_id := (SELECT get_station_id_from_auth());
    IF v_auth_station_id IS NULL OR v_auth_station_id != p_station_id THEN
        RAISE EXCEPTION 'Unauthorized: User does not belong to the requested station';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'usage_type', usage_type,
        'total_quantity', SUM(quantity),
        'total_cost', SUM(total_cost)
    ))
    FROM usage_logs
    WHERE station_id = p_station_id
      AND timestamp > (now() - (p_days || ' days')::INTERVAL)
    GROUP BY usage_type
    INTO result;
    
    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- ============================================================================
-- 3. PERMISSIONS
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_tankiq_station_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_shift_analytics(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_financial_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_hardware_health(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_audit_logs(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_support_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_usage_insights(UUID, INTEGER) TO authenticated;
