-- supabase/migrations/20260506190000_fix_stale_function_schema_drift.sql
-- ============================================================
-- FIX ALL STALE FUNCTIONS WITH SCHEMA DRIFT ERRORS
-- Resolves all errors reported by `supabase db lint --linked`
-- ============================================================

-- ============================================================
-- FIX 1: log_auth_attempt (4-param overload)
-- Error: column "description" and "metadata" of relation
--        "security_telemetry_events" do not exist.
-- Fix: Use the actual columns: event_type, severity, source,
--      actor_email, reason, details
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_auth_attempt(
    p_email TEXT,
    p_success BOOLEAN,
    p_ip TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.security_telemetry_events (
        event_type,
        severity,
        source,
        actor_email,
        reason,
        details
    ) VALUES (
        'AUTH_ATTEMPT',
        CASE WHEN p_success THEN 'info' ELSE 'warning' END,
        'auth',
        p_email,
        CASE WHEN p_success THEN 'Login successful' ELSE 'Login failed' END,
        jsonb_build_object(
            'ip',         p_ip,
            'user_agent', p_user_agent,
            'success',    p_success
        )
    );
EXCEPTION WHEN OTHERS THEN
    -- Never fail an auth operation due to logging errors
    RAISE WARNING 'log_auth_attempt failed: %', SQLERRM;
END;
$$;

-- ============================================================
-- FIX 2: check_auth_attempt
-- Error: net.ip_address_to_inet() function not found (in the
--        log_auth_attempt 2-param overload that also inserts
--        to auth_attempts).
-- Additionally: check_auth_attempt returns TABLE type — we
--   cannot use CREATE OR REPLACE to change return type, so we
--   must DROP first.
-- ============================================================

-- Fix 2a: log_auth_attempt (2-param overload) — replace net extension call with ::INET
CREATE OR REPLACE FUNCTION public.log_auth_attempt(p_email TEXT, p_is_success BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ip_raw TEXT;
    v_ip INET;
BEGIN
    v_ip_raw := current_setting('request.headers', true)::json->>'x-real-ip';
    BEGIN
        v_ip := v_ip_raw::INET;  -- FIX: use direct cast instead of net extension
    EXCEPTION WHEN OTHERS THEN
        v_ip := NULL;
    END;

    INSERT INTO public.auth_attempts (email, is_success, ip_address)
    VALUES (LOWER(TRIM(p_email)), p_is_success, v_ip);
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.auth_attempts (email, is_success)
    VALUES (LOWER(TRIM(p_email)), p_is_success);
END;
$$;

-- Fix 2b: check_auth_attempt — keep same TABLE return type,
-- just fix the function body to be safe.
-- DROP first to handle any return-type mismatch in the live DB.
DROP FUNCTION IF EXISTS public.check_auth_attempt(TEXT);
CREATE OR REPLACE FUNCTION public.check_auth_attempt(p_email TEXT)
RETURNS TABLE (
    allowed           BOOLEAN,
    remaining_attempts INTEGER,
    reset_time        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_window_start TIMESTAMPTZ := NOW() - INTERVAL '15 minutes';
    v_failed_count INTEGER := 0;
    v_first_failed TIMESTAMPTZ;
BEGIN
    p_email := LOWER(TRIM(p_email));

    SELECT COUNT(*), MIN(attempted_at)
    INTO v_failed_count, v_first_failed
    FROM public.auth_attempts
    WHERE email = p_email
      AND attempted_at > v_window_start
      AND is_success = FALSE;

    IF v_failed_count >= 5 THEN
        RETURN QUERY SELECT FALSE, 0, v_first_failed + INTERVAL '15 minutes';
    ELSE
        RETURN QUERY SELECT TRUE, 5 - v_failed_count, COALESCE(v_first_failed + INTERVAL '15 minutes', NOW() + INTERVAL '15 minutes');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT TRUE, 5, NOW() + INTERVAL '15 minutes';
END;
$$;

-- ============================================================
-- FIX 3: add_debt_to_client
-- Error: column "id" does not exist on fuel_stations
--        (PK was renamed to station_id)
-- Fix: WHERE station_id = p_station_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_debt_to_client(
    p_station_id UUID,
    p_amount DECIMAL,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.fuel_stations
    SET current_debt = current_debt + p_amount,
        updated_at = NOW()
    WHERE station_id = p_station_id;

    INSERT INTO public.transactions (
        station_id, transaction_type, amount, description, payment_status
    ) VALUES (
        p_station_id, 'charge', p_amount, p_reason, 'pending'
    );
END;
$$;

-- ============================================================
-- FIX 4: forensic_update_market_price
-- Error 1: market_prices.metadata does not exist (not in schema)
-- Error 2: market_signals.timestamp is BIGINT but now() is
--          TIMESTAMPTZ — must convert to epoch ms (already done
--          in the v2 overload but not in the earlier one)
-- Fix: Drop market_prices metadata references; use correct
--      epoch conversion for market_signals.timestamp
-- Also drop the obsolete older overload from 20260424121800
-- that still has the bug.
-- ============================================================
DROP FUNCTION IF EXISTS public.forensic_update_market_price(TEXT, NUMERIC, TIMESTAMPTZ, TEXT, BOOLEAN, TEXT);

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
    -- 1. Insert/update market price (no metadata column in market_prices)
    INSERT INTO public.market_prices (
        fuel_type, price_per_liter, effective_date, source, region
    ) VALUES (
        p_fuel_type,
        p_new_price,
        p_effective_date::DATE,
        CASE WHEN p_is_official THEN 'epra' ELSE 'manual' END,
        'kenya'
    )
    ON CONFLICT (fuel_type, source, region, effective_date)
    DO UPDATE SET
        price_per_liter = EXCLUDED.price_per_liter;

    -- 2. Process action queue for all stations if official
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

        -- 3. Insert market signal (timestamp is BIGINT → epoch ms)
        INSERT INTO public.market_signals (
            id, type, source, source_type, title, summary,
            relevance_score, confidence_score,
            timestamp,           -- BIGINT: milliseconds since epoch
            external_url
        ) VALUES (
            v_final_signal_id,
            'regulatory', 'EPRA', 'Regulatory',
            'Official Price Adjustment: ' || p_fuel_type,
            'EPRA has officially updated the retail price for ' || p_fuel_type ||
            ' to KES ' || p_new_price || '. Effective immediately.',
            1.0, 1.0,
            extract(epoch from now())::bigint * 1000,  -- FIX: timestamptz → bigint ms
            p_source_url
        ) ON CONFLICT (id) DO NOTHING;
    END IF;
END;
$$;

-- ============================================================
-- FIX 5: get_business_kpis_v2
-- Error: cannot cast composite value of "record" type to boolean.
-- Root cause: consume_edge_rate_limit() is called via
--   SELECT fn() INTO bool_var — but the function is SETOF, so
--   PostgreSQL treats it as a record, not a scalar.
-- Fix: Call it as a scalar expression directly.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_business_kpis_v2()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_rate_limit_ok BOOLEAN;
BEGIN
    -- FIX: call as scalar boolean expression, not via SELECT INTO
    v_rate_limit_ok := public.consume_edge_rate_limit(
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

-- ============================================================
-- FIX 6: get_admin_dashboard_stats
-- Error: relation "public.admin_logs" does not exist.
-- Fix: Replace admin_logs query with unified_events for activity
--      feed. Keep the EXCEPTION guard so it fails safely.
-- ============================================================
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
    SELECT COUNT(DISTINCT device_id) INTO c_online_devs
    FROM public.sensor_readings
    WHERE created_at > NOW() - INTERVAL '15 minutes';

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

    -- Recent activity: FIX — use unified_events instead of admin_logs
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

-- ============================================================
-- FIX 7: get_tankiq_delivery_logs
-- Error: column "d.delivery_date" must appear in GROUP BY or
--        be used in an aggregate function.
-- Fix: The ORDER BY inside jsonb_agg() is not supported when
--      the subquery has no GROUP BY. Wrap in a subquery first.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_tankiq_delivery_logs(
    p_station_id UUID,
    p_limit INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_agg(jsonb_build_object(
        'tank_name', sub.tank_name,
        'volume',    sub.actual_received_volume,
        'date',      sub.delivery_date,
        'supplier',  sub.supplier_name
    ))
    INTO result
    FROM (
        SELECT
            t.tank_name,
            d.actual_received_volume,
            d.delivery_date,
            d.supplier_name
        FROM deliveries d
        JOIN tanks t ON d.tank_id = t.id
        WHERE d.station_id = p_station_id
        ORDER BY d.delivery_date DESC
        LIMIT p_limit
    ) sub;

    RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- ============================================================
-- FIX 8: get_tankiq_market_context
-- Error: column "regulatory_notices.created_at" must appear
--        in GROUP BY or aggregate.
-- Fix: Wrap the ORDER BY in a subquery, same pattern as above.
-- ============================================================
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
                'price',     price_per_liter,
                'source',    source,
                'date',      effective_date
            ))
            FROM (
                SELECT DISTINCT ON (fuel_type)
                    fuel_type, price_per_liter, source, effective_date
                FROM market_prices
                WHERE source = 'epra'
                ORDER BY fuel_type, effective_date DESC
            ) prices_sub
        ),
        'regulatory_notices', (
            SELECT jsonb_agg(jsonb_build_object(
                'title',          title,
                'summary',        summary,
                'effective_date', effective_date
            ))
            FROM (
                SELECT title, summary, effective_date, created_at
                FROM regulatory_notices
                ORDER BY created_at DESC
                LIMIT 2
            ) notices_sub
        )
    ) INTO result;

    RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
