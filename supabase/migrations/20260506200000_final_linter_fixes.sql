-- supabase/migrations/20260506200000_final_linter_fixes.sql
-- ============================================================
-- FINAL LINTER REMEDIATION
-- 1. Add missing metadata column to market_prices
-- 2. Drop and unify forensic_update_market_price overloads
-- 3. Fix get_business_kpis_v2 rate limit assignment
-- 4. Fix get_admin_dashboard_stats column references
-- ============================================================

-- 1. Add metadata column to market_prices if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'market_prices' AND column_name = 'metadata') THEN
        ALTER TABLE public.market_prices ADD COLUMN metadata JSONB DEFAULT '{}'::JSONB;
    END IF;
END $$;

-- 2. Drop all known overloads of forensic_update_market_price to ensure a clean state
DROP FUNCTION IF EXISTS public.forensic_update_market_price(TEXT, DECIMAL, DATE, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.forensic_update_market_price(TEXT, NUMERIC, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT);

-- 3. Re-create unified forensic_update_market_price
CREATE OR REPLACE FUNCTION public.forensic_update_market_price(
    p_fuel_type TEXT,
    p_new_price NUMERIC,
    p_effective_date TIMESTAMPTZ,
    p_source_url TEXT DEFAULT NULL,
    p_is_official BOOLEAN DEFAULT FALSE,
    p_signal_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_price NUMERIC;
    v_price_variance NUMERIC;
    v_station_record RECORD;
    v_final_signal_id TEXT := COALESCE(
        p_signal_id,
        'sig-' || md5(p_fuel_type || p_effective_date::TEXT)
    );
BEGIN
    -- Insert/update market price
    INSERT INTO public.market_prices (
        fuel_type, price_per_liter, effective_date, source, region, metadata
    ) VALUES (
        p_fuel_type,
        p_new_price,
        p_effective_date::DATE,
        CASE WHEN p_is_official THEN 'epra' ELSE 'manual' END,
        'kenya',
        jsonb_build_object('source_url', p_source_url, 'is_official', p_is_official, 'signal_id', v_final_signal_id)
    )
    ON CONFLICT (fuel_type, source, region, effective_date)
    DO UPDATE SET
        price_per_liter = EXCLUDED.price_per_liter,
        metadata = public.market_prices.metadata || EXCLUDED.metadata;

    -- Process action queue for all stations if official
    IF p_is_official THEN
        FOR v_station_record IN
            SELECT station_id, station_name FROM public.fuel_stations
        LOOP
            SELECT price_per_liter INTO v_old_price
            FROM public.market_prices
            WHERE fuel_type = p_fuel_type
              AND source = 'epra'
              AND effective_date < p_effective_date::DATE
            ORDER BY effective_date DESC LIMIT 1;

            v_price_variance := p_new_price - COALESCE(v_old_price, p_new_price);

            IF v_price_variance != 0 THEN
                IF NOT EXISTS (
                    SELECT 1 FROM public.market_action_queue
                    WHERE station_id = v_station_record.station_id
                      AND fuel_type = p_fuel_type
                      AND effective_date = p_effective_date::DATE
                ) THEN
                    INSERT INTO public.market_action_queue (
                        station_id, fuel_type, old_price, new_price,
                        effective_date, action_type, status, metadata
                    ) VALUES (
                        v_station_record.station_id,
                        p_fuel_type,
                        v_old_price,
                        p_new_price,
                        p_effective_date::DATE,
                        'price_adjustment',
                        'pending',
                        jsonb_build_object(
                            'variance',      v_price_variance,
                            'source_url',    p_source_url,
                            'station_name',  v_station_record.station_name,
                            'signal_id',     v_final_signal_id
                        )
                    );
                END IF;
            END IF;
        END LOOP;

        -- Insert market signal
        INSERT INTO public.market_signals (
            id, type, source, source_type, title, summary,
            relevance_score, confidence_score,
            timestamp,
            external_url
        ) VALUES (
            v_final_signal_id,
            'regulatory', 'EPRA', 'Regulatory',
            'Official Price Adjustment: ' || p_fuel_type,
            'EPRA has officially updated the retail price for ' || p_fuel_type ||
            ' to KES ' || p_new_price || '. Effective immediately.',
            1.0, 1.0,
            extract(epoch from now())::bigint * 1000,
            p_source_url
        ) ON CONFLICT (id) DO NOTHING;
    END IF;
END;
$$;

-- 4. Fix get_business_kpis_v2 rate limit assignment
CREATE OR REPLACE FUNCTION public.get_business_kpis_v2()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_rate_limit_ok BOOLEAN;
BEGIN
    -- Correctly handle TABLE return type from consume_edge_rate_limit
    SELECT allowed INTO v_rate_limit_ok 
    FROM public.consume_edge_rate_limit(
        (SELECT auth.uid())::text,
        'get_business_kpis',
        60,
        10
    );

    IF NOT v_rate_limit_ok THEN
        RAISE EXCEPTION 'Rate limit exceeded for business analytics. Please wait a minute.';
    END IF;

    RETURN public.get_business_kpis();
END;
$$;

-- 5. Fix get_admin_dashboard_stats column references
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
    v_mrr DECIMAL := 0;
    v_debt DECIMAL := 0;
    v_recent_activity JSONB := '[]'::jsonb;
    v_result JSONB;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.system_users
        WHERE auth_user_id = v_uid
          AND is_active = TRUE
          AND role IN ('super_admin', 'admin_helper')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Super Admin access required.';
    END IF;

    -- General metrics
    SELECT COUNT(*) INTO c_users    FROM public.profiles;
    SELECT COUNT(*) INTO c_tanks    FROM public.tanks;
    SELECT COUNT(*) INTO c_stations FROM public.fuel_stations;
    SELECT COUNT(*) INTO c_operators FROM public.system_users WHERE is_active = TRUE;

    -- Online devices (sensor_readings within last 15 min)
    -- FIX: tank_id instead of device_id, timestamp instead of created_at
    SELECT COUNT(DISTINCT tank_id) INTO c_online_devs
    FROM public.sensor_readings
    WHERE timestamp > NOW() - INTERVAL '15 minutes';

    -- Financial metrics
    SELECT COALESCE(SUM(current_debt), 0) INTO v_debt FROM public.fuel_stations;
    SELECT COALESCE(SUM(amount), 0) INTO v_mrr
    FROM public.transactions
    WHERE transaction_type IN ('charge', 'usage_charge')
      AND payment_status = 'completed'
      AND created_at >= DATE_TRUNC('month', NOW());

    -- Support metrics
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'support_tickets'
    ) THEN
        EXECUTE 'SELECT COUNT(*) FROM public.support_tickets WHERE status IN (''open'', ''in_progress'')' INTO c_open_tickets;
        EXECUTE 'SELECT COUNT(*) FROM public.support_tickets WHERE priority = ''urgent'' AND status IN (''open'', ''in_progress'')' INTO c_urgent_tickets;
    END IF;

    SELECT COUNT(*) INTO c_pending_reqs
    FROM public.pending_registrations WHERE status = 'pending';

    -- Recent activity
    BEGIN
        SELECT jsonb_agg(act) INTO v_recent_activity
        FROM (
            (
                SELECT
                    'event'      AS type,
                    event_type || ': ' || COALESCE(description, '')  AS text,
                    created_at,
                    id::text
                FROM public.unified_events
                ORDER BY created_at DESC
                LIMIT 10
            )
            UNION ALL
            (
                SELECT
                    'registration'  AS type,
                    'New request: ' || full_name || ' (' || station_name || ')' AS text,
                    created_at,
                    id::text
                FROM public.pending_registrations
                WHERE status = 'pending'
                ORDER BY created_at DESC
                LIMIT 5
            )
            ORDER BY created_at DESC
            LIMIT 15
        ) act;
    EXCEPTION WHEN OTHERS THEN
        v_recent_activity := '[]'::jsonb;
    END;

    v_result := jsonb_build_object(
        'health', jsonb_build_object(
            'totalUsers',     c_users,
            'totalTanks',     c_tanks,
            'totalStations',  c_stations,
            'totalOperators', c_operators,
            'uptime',         '99.98%',
            'dbSize',         (SELECT pg_size_pretty(pg_database_size(current_database()))),
            'espDevices',     jsonb_build_object('online', c_online_devs, 'total', c_tanks),
            'apiStatus',      jsonb_build_object('supabase', 'green', 'twilio', 'green')
        ),
        'financial', jsonb_build_object(
            'mrr',             v_mrr,
            'arr',             v_mrr * 12,
            'outstandingDebt', v_debt
        ),
        'support', jsonb_build_object(
            'openTickets',     c_open_tickets,
            'urgentTickets',   c_urgent_tickets,
            'pendingRequests', c_pending_reqs
        ),
        'recentActivity', COALESCE(v_recent_activity, '[]'::jsonb)
    );

    RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
