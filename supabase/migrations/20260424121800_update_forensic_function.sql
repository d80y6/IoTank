-- Update forensic_update_market_price to include market_signals insertion
-- Consolidated version: Handles both official (EPRA) and news-based signals
CREATE OR REPLACE FUNCTION public.forensic_update_market_price(
    p_fuel_type TEXT,
    p_new_price NUMERIC,
    p_effective_date TIMESTAMPTZ,
    p_source_url TEXT DEFAULT NULL,
    p_is_official BOOLEAN DEFAULT FALSE,
    p_signal_id TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_old_price NUMERIC;
    v_price_variance NUMERIC;
    v_station_record RECORD;
    v_final_signal_id TEXT := COALESCE(p_signal_id, 'sig-' || md5(p_fuel_type || p_effective_date::TEXT));
BEGIN
    -- 1. Atomic Update of Market Prices
    INSERT INTO public.market_prices (fuel_type, price_per_liter, effective_date, source, metadata)
    VALUES (
        p_fuel_type, 
        p_new_price, 
        p_effective_date, 
        CASE WHEN p_is_official THEN 'epra' ELSE 'news' END, 
        jsonb_build_object('source_url', p_source_url, 'is_official', p_is_official, 'signal_id', v_final_signal_id)
    )
    ON CONFLICT (fuel_type, source, region, effective_date) 
    DO UPDATE SET 
        price_per_liter = EXCLUDED.price_per_liter,
        metadata = public.market_prices.metadata || EXCLUDED.metadata;

    -- 2. Process Action Queue for All Stations if Official
    IF p_is_official THEN
        -- [FIX]: Use public.fuel_stations instead of public.stations
        FOR v_station_record IN SELECT station_id, station_name FROM public.fuel_stations LOOP
            -- Get latest price for this station/fuel
            SELECT price_per_liter INTO v_old_price 
            FROM public.market_prices 
            WHERE fuel_type = p_fuel_type 
            AND source = 'epra'
            AND effective_date < p_effective_date
            ORDER BY effective_date DESC LIMIT 1;

            v_price_variance := p_new_price - COALESCE(v_old_price, p_new_price);

            IF v_price_variance != 0 THEN
                -- 3. Insert into Action Queue (Deduplicated by signal_id)
                IF NOT EXISTS (
                    SELECT 1 FROM public.market_action_queue 
                    WHERE station_id = v_station_record.station_id 
                    AND fuel_type = p_fuel_type 
                    AND effective_date = p_effective_date::DATE
                ) THEN
                    INSERT INTO public.market_action_queue (
                        station_id, fuel_type, old_price, new_price, effective_date, action_type, status, metadata
                    ) VALUES (
                        v_station_record.station_id,
                        p_fuel_type,
                        v_old_price,
                        p_new_price,
                        p_effective_date::DATE,
                        'price_adjustment',
                        'pending',
                        jsonb_build_object(
                            'variance', v_price_variance,
                            'source_url', p_source_url,
                            'station_name', v_station_record.station_name,
                            'signal_id', v_final_signal_id
                        )
                    );

                    -- 4. Create System Notification
                    INSERT INTO public.system_notifications (
                        category,
                        priority,
                        title,
                        message,
                        metadata
                    ) VALUES (
                        'system',
                        'critical',
                        'Official EPRA Price Change',
                        'EPRA has updated ' || p_fuel_type || ' prices. New rate: KES ' || p_new_price || ' (Prev: ' || COALESCE(v_old_price::TEXT, 'Unknown') || '). Action required for ' || v_station_record.station_name || '.',
                        jsonb_build_object(
                            'station_id', v_station_record.station_id,
                            'fuel_type', p_fuel_type,
                            'new_price', p_new_price,
                            'signal_id', v_final_signal_id
                        )
                    );
                END IF;
            END IF;
        END LOOP;

        -- 5. Insert Global Market Signal for Feed Visibility (Deduplicated)
        INSERT INTO public.market_signals (
            id, type, source, source_type, title, summary, 
            relevance_score, confidence_score, timestamp, external_url
        ) VALUES (
            v_final_signal_id,
            'regulatory', 'EPRA', 'Regulatory',
            'Official Price Adjustment: ' || p_fuel_type,
            'EPRA has officially updated the retail price for ' || p_fuel_type || ' to KES ' || p_new_price || '. Effective immediately.',
            1.0, 1.0, extract(epoch from now())::bigint * 1000, p_source_url
        ) ON CONFLICT (id) DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

