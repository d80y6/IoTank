-- 99999999000037_bridge_wire_orphan_endpoints.sql
-- Four layers:
--   1) Guard the orphaned-but-open RPCs (several are anon-executable data leaks / mutators)
--   2) Fix schema drift that breaks them on the partitioned telemetry path
--   3) Make orphaned data *usable*: staff read policies, partition/event maintenance,
--      materialized-view refresh, smoothing URL config
--   4) Data tools the apps call from System Utilities (legacy readings + pre-partition backfills)

-- =====================================================================================
-- 1) GUARDS + FIXES on wired RPCs
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.add_debt_to_client(p_station_id uuid, p_amount numeric, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Permission Denied: Staff role required to adjust client debt.';
    END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_old_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Permission Denied: Staff role required for event retention cleanup.';
    END IF;
    DELETE FROM public.unified_events WHERE created_at < NOW() - INTERVAL '1 year';
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_business_kpis_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_rate_limit_ok BOOLEAN;
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Permission Denied: Staff role required for business analytics.';
    END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.get_supplier_reliability_score(p_supplier_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_score JSON;
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Permission Denied: Staff role required for supplier analytics.';
    END IF;

    SELECT json_build_object(
        'supplier_name', p_supplier_name,
        'total_deliveries', COUNT(*),
        'verified_ok', COUNT(*) FILTER (WHERE d.verification_status = 'verified_ok'),
        'disputed_shortages', COUNT(*) FILTER (WHERE d.verification_status = 'disputed_shortage'),
        'avg_variance_percentage', ROUND(AVG(d.variance_percentage)::NUMERIC, 2),
        'reliability_score', ROUND((
            COUNT(*) FILTER (WHERE d.verification_status = 'verified_ok')::DECIMAL
            / NULLIF(COUNT(*), 0) * 100
        )::NUMERIC, 2)
    ) INTO v_score
    FROM public.deliveries d
    WHERE d.supplier_name = p_supplier_name
      AND d.created_at >= NOW() - INTERVAL '12 months';
    RETURN v_score;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_index_exists(p_index_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Permission Denied: Staff role required for index diagnostics.';
    END IF;
    RETURN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = p_index_name);
END;
$function$;

-- Fix: previous body ordered by a `timestamp` column that no longer exists on the
-- partitioned sensor_readings, and it had no access guard.
CREATE OR REPLACE FUNCTION public.detect_theft_anomaly(p_tank_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_last_vol DECIMAL;
    v_curr_vol DECIMAL;
BEGIN
    IF NOT public.check_is_staff()
       AND NOT EXISTS (
           SELECT 1 FROM public.tanks t
           JOIN public.profiles p ON p.station_id = t.station_id
           WHERE t.id = p_tank_id AND p.auth_user_id = auth.uid()
       ) THEN
        RAISE EXCEPTION 'Permission Denied: No access to this tank.';
    END IF;

    SELECT current_volume INTO v_curr_vol FROM public.tanks WHERE id = p_tank_id;

    SELECT volume INTO v_last_vol
    FROM public.sensor_readings
    WHERE tank_id = p_tank_id
    ORDER BY captured_at DESC
    OFFSET 1 LIMIT 1;

    IF v_last_vol IS NOT NULL AND v_last_vol - v_curr_vol > 50 THEN
        RETURN TRUE;
    END IF;
    RETURN FALSE;
END;
$function$;

-- Auth-attempt recorder for the client login flow (auth_attempts auto-insert policy is
-- public, but a guarded RPC keeps it consistent and DB-controlled).
CREATE OR REPLACE FUNCTION public.log_auth_attempt(p_email text, p_ip text, p_success boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO public.auth_attempts (email, ip_address, attempted_at, is_success)
    VALUES (
        NULLIF(p_email, ''),
        CASE WHEN p_ip ~ '^[0-9.]+$' THEN p_ip::inet ELSE NULL END,
        NOW(),
        COALESCE(p_success, false)
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to log auth attempt: %', SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_debt_to_client(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_debt_to_client(uuid, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cleanup_old_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_old_events() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_business_kpis_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_kpis_v2() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_supplier_reliability_score(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_reliability_score(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_index_exists(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_index_exists(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.detect_theft_anomaly(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_theft_anomaly(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.log_auth_attempt(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_auth_attempt(text, text, boolean) TO anon, authenticated, service_role;

-- =====================================================================================
-- 2) STAFF READ POLICIES for service-role-only tables surfaced in the admin UI
-- =====================================================================================

DROP POLICY IF EXISTS "Staff view edge rate limits" ON public.edge_rate_limits;
CREATE POLICY "Staff view edge rate limits" ON public.edge_rate_limits
    FOR SELECT USING (public.check_is_staff());

DROP POLICY IF EXISTS "Staff view scraper rate limits" ON public.scraper_rate_limits;
CREATE POLICY "Staff view scraper rate limits" ON public.scraper_rate_limits
    FOR SELECT USING (public.check_is_staff());

DROP POLICY IF EXISTS "Staff view telemetry history" ON public.telemetry_history;
CREATE POLICY "Staff view telemetry history" ON public.telemetry_history
    FOR SELECT USING (public.check_is_staff());

-- =====================================================================================
-- 3) MAINTENANCE: sensor_readings partitions + analytics materialized view + realtime
-- =====================================================================================

CREATE OR REPLACE FUNCTION internal.manage_sensor_readings_partitions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    cur record;
    v_start date;
    v_end date;
    v_part text;
BEGIN
    -- Ensure partitions for the current month + the next two
    FOR cur IN
        SELECT to_char(g, 'YYYY-MM-DD') AS m
        FROM generate_series(date_trunc('month', now()), date_trunc('month', now()) + interval '2 months', interval '1 month') AS g
    LOOP
        v_start := cur.m::date;
        v_end := (v_start + interval '1 month')::date;
        v_part := 'sensor_readings_y' || to_char(v_start, 'YYYY') || 'm' || to_char(v_start, 'MM');
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = v_part AND c.relkind = 'r'
        ) THEN
            EXECUTE format(
                'CREATE TABLE public.%I PARTITION OF public.sensor_readings FOR VALUES FROM (%L) TO (%L)',
                v_part, v_start, v_end
            );
        END IF;
    END LOOP;
END;
$function$;

SELECT cron.schedule('manage-sensor-readings-partitions', '0 4 1 * *', $$SELECT internal.manage_sensor_readings_partitions();$$);

-- Data-smoothing: read the forwarding URL from a per-request header or the GLOBAL
-- jurisdiction config (wiring jurisdiction_configs into a real feature), fall back to prod.
CREATE OR REPLACE FUNCTION internal.smoothing_target_url()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_url text;
BEGIN
    v_url := NULLIF(current_setting('app.settings.data_smoothing_url', true), '');
    IF v_url IS NULL THEN
        SELECT NULLIF(config_value ->> 'url', '') INTO v_url
        FROM public.jurisdiction_configs
        WHERE jurisdiction_code = 'GLOBAL' AND config_key = 'data_smoothing_url' AND is_active;
    END IF;
    RETURN COALESCE(v_url, 'https://suifvborodwergtrbjez.supabase.co/functions/v1/data-smoothing');
END;
$function$;

CREATE OR REPLACE FUNCTION internal.handle_data_smoothing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF internal.smoothing_target_url() IS NOT NULL
       AND current_setting('app.settings.service_role_key', true) IS NOT NULL THEN
        PERFORM net.http_post(
            url := internal.smoothing_target_url(),
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
            ),
            body := jsonb_build_object('record', to_jsonb(NEW))
        );
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$function$;

-- Partitioned-table variant: normalizes rows (captured_at / metadata.rssi) into the payload
-- shape the data-smoothing Edge Function expects.
CREATE OR REPLACE FUNCTION internal.handle_partitioned_data_smoothing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF internal.smoothing_target_url() IS NOT NULL
       AND current_setting('app.settings.service_role_key', true) IS NOT NULL THEN
        PERFORM net.http_post(
            url := internal.smoothing_target_url(),
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
            ),
            body := jsonb_build_object('record', jsonb_build_object(
                'id', NEW.id,
                'tank_id', NEW.tank_id,
                'station_id', NEW.station_id,
                'volume', NEW.volume,
                'temperature', NEW.temperature,
                'water_level', NEW.water_level,
                'captured_at', NEW.captured_at,
                'rssi', NULLIF(NEW.metadata ->> 'rssi', '')::integer,
                'source', 'partitioned'
            ))
        );
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_data_smoothing_partitioned ON public.sensor_readings;
CREATE TRIGGER trigger_data_smoothing_partitioned
AFTER INSERT ON public.sensor_readings
FOR EACH ROW EXECUTE FUNCTION internal.handle_partitioned_data_smoothing();

-- tank_analytics_30d materialized view now sources from the LIVE partitioned telemetry
-- (previously pointed at the never-written legacy table) and is refreshed by cron.
DROP MATERIALIZED VIEW IF EXISTS public.tank_analytics_30d;
CREATE MATERIALIZED VIEW public.tank_analytics_30d AS
SELECT
    tank_id,
    station_id,
    avg(volume) AS avg_volume,
    min(volume) AS min_volume,
    max(volume) AS max_volume,
    avg(temperature) AS avg_temperature,
    count(*) AS reading_count,
    now() AS last_calculated_at
FROM public.sensor_readings
WHERE captured_at > now() - interval '30 days'
GROUP BY tank_id, station_id;

CREATE UNIQUE INDEX IF NOT EXISTS tank_analytics_30d_pk ON public.tank_analytics_30d(tank_id, station_id);
GRANT SELECT ON public.tank_analytics_30d TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_tank_analytics()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Permission Denied: Staff role required.';
    END IF;
    REFRESH MATERIALIZED VIEW public.tank_analytics_30d;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_tank_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_tank_analytics() TO authenticated, service_role;

SELECT cron.schedule('refresh-tank-analytics', '0 3 * * *', $$SELECT public.refresh_tank_analytics();$$);

-- Realtime: publish live telemetry inserts (the legacy table was published, not the live one)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sensor_readings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_readings;
    END IF;
END
$$;

-- =====================================================================================
-- 4) DATA TOOLS (System Utilities page)
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.migrate_legacy_sensor_readings(p_limit integer DEFAULT 5000)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_migrated bigint := 0;
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Permission Denied: Staff role required.';
    END IF;

    WITH batch AS (
        SELECT l.id, l.station_id, l.tank_id, l.volume, l.temperature, l.rssi, l."timestamp"
        FROM public.sensor_readings_legacy l
        WHERE NOT EXISTS (
            SELECT 1 FROM public.sensor_readings sr WHERE sr.metadata ->> 'source_id' = l.id::text
        )
        ORDER BY l."timestamp" DESC
        LIMIT p_limit
    )
    INSERT INTO public.sensor_readings (id, station_id, tank_id, volume, temperature, captured_at, metadata)
    SELECT id, station_id, tank_id,
           volume::double precision,
           temperature::double precision,
           ("timestamp" AT TIME ZONE 'UTC'),
           jsonb_build_object('source_id', id::text, 'source', 'legacy', 'rssi', rssi)
    FROM batch;

    GET DIAGNOSTICS v_migrated = ROW_COUNT;
    RETURN v_migrated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_events_pre_partition(p_limit integer DEFAULT 5000)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_migrated bigint := 0;
        v_month text;
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Permission Denied: Staff role required.';
    END IF;

    -- Ensure target partitions exist for every month present in the batch
    FOR v_month IN
        SELECT DISTINCT to_char(created_at, 'YYYY_MM') FROM public.unified_events_pre_partition
    LOOP
        PERFORM internal.create_event_partition(v_month);
    END LOOP;

    WITH batch AS (
        SELECT p.* FROM public.unified_events_pre_partition p
        WHERE NOT EXISTS (
            SELECT 1 FROM public.unified_events ue WHERE ue.metadata ->> 'source_id' = p.id::text
        )
        ORDER BY p.created_at DESC
        LIMIT p_limit
    )
    INSERT INTO public.unified_events (
        station_id, event_category, event_type, description, actor_id, actor_email,
        metadata, created_at, severity, is_resolved
    )
    SELECT station_id, event_category, event_type, description, actor_id, actor_email,
           jsonb_build_object('source_id', id::text, 'source', 'pre_partition') || COALESCE(metadata, '{}'::jsonb),
           created_at, severity, is_resolved
    FROM batch;

    GET DIAGNOSTICS v_migrated = ROW_COUNT;
    RETURN v_migrated;
END;
$function$;

REVOKE ALL ON FUNCTION public.migrate_legacy_sensor_readings(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.migrate_legacy_sensor_readings(integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.backfill_events_pre_partition(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_events_pre_partition(integer) TO authenticated, service_role;