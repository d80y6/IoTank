-- supabase/migrations/20260506210000_cleanup_forensic_overloads.sql
-- ============================================================
-- CLEANUP FORENSIC OVERLOADS
-- 1. Use a DO block to drop all overloads of forensic_update_market_price
-- 2. Re-create the canonical 6-arg version with correct ON CONFLICT
-- ============================================================

-- 1. Drop ALL versions of the function to clear any stale overloads
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oidvectortypes(proargtypes) as args 
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE p.proname = 'forensic_update_market_price'
          AND n.nspname = 'public'
    ) LOOP
        EXECUTE 'DROP FUNCTION public.forensic_update_market_price(' || r.args || ')';
    END LOOP;
END $$;

-- 2. Re-create the canonical version
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

NOTIFY pgrst, 'reload schema';
