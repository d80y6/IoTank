-- supabase/migrations/20260424120000_market_forensics.sql

-- 1. Create Market Action Queue for required operational responses
CREATE TABLE IF NOT EXISTS public.market_action_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES public.fuel_stations(station_id) ON DELETE CASCADE,
    fuel_type TEXT NOT NULL,
    old_price DECIMAL(10,2),
    new_price DECIMAL(10,2) NOT NULL,
    effective_date DATE NOT NULL,
    action_type TEXT DEFAULT 'price_adjustment' CHECK (action_type IN ('price_adjustment', 'procurement_hedge', 'compliance_review')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'ignored')),
    metadata JSONB DEFAULT '{}'::JSONB, -- { "source_url": "...", "signal_id": "..." }
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for market_action_queue
ALTER TABLE public.market_action_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage action queue" ON public.market_action_queue;
CREATE POLICY "Admins manage action queue" ON public.market_action_queue
    FOR ALL USING (EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = auth.uid() AND is_active = TRUE));

DROP POLICY IF EXISTS "Clients see their own action queue" ON public.market_action_queue;
CREATE POLICY "Clients see their own action queue" ON public.market_action_queue
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE auth_user_id = auth.uid() AND station_id = market_action_queue.station_id
        )
    );

-- 2. Forensic Price Update Logic
CREATE OR REPLACE FUNCTION public.forensic_update_market_price(
    p_fuel_type TEXT,
    p_new_price DECIMAL(10,2),
    p_effective_date DATE,
    p_source_url TEXT DEFAULT NULL,
    p_signal_id TEXT DEFAULT NULL
)
RETURNS void AS $$
DECLARE
    v_old_price DECIMAL(10,2);
    v_station_record RECORD;
BEGIN
    -- 1. Get last known official price for this fuel type
    SELECT price_per_liter INTO v_old_price
    FROM public.market_prices
    WHERE fuel_type = p_fuel_type
      AND source = 'epra'
    ORDER BY effective_date DESC
    LIMIT 1;

    -- 2. If price is different, update market_prices and trigger alerts
    IF v_old_price IS NULL OR v_old_price <> p_new_price THEN
        -- Insert new official price
        INSERT INTO public.market_prices (
            fuel_type,
            price_per_liter,
            source,
            effective_date
        ) VALUES (
            p_fuel_type,
            p_new_price,
            'epra',
            p_effective_date
        ) ON CONFLICT (fuel_type, source, region, effective_date) DO UPDATE
        SET price_per_liter = EXCLUDED.price_per_liter;

        -- 3. Create Action Items for ALL affected stations
        FOR v_station_record IN SELECT station_id, station_name FROM public.fuel_stations LOOP
            
            -- Avoid duplicate pending actions for same fuel/date
            IF NOT EXISTS (
                SELECT 1 FROM public.market_action_queue 
                WHERE station_id = v_station_record.station_id 
                AND fuel_type = p_fuel_type 
                AND effective_date = p_effective_date
                AND status = 'pending'
            ) THEN
                INSERT INTO public.market_action_queue (
                    station_id,
                    fuel_type,
                    old_price,
                    new_price,
                    effective_date,
                    metadata
                ) VALUES (
                    v_station_record.station_id,
                    p_fuel_type,
                    v_old_price,
                    p_new_price,
                    p_effective_date,
                    jsonb_build_object(
                        'source_url', p_source_url,
                        'signal_id', p_signal_id,
                        'variance', p_new_price - v_old_price
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
                        'new_price', p_new_price
                    )
                );
            END IF;
        END LOOP;

        -- 5. Insert Global Market Signal for Feed Visibility (Deduplicated)
        INSERT INTO public.market_signals (
            type, source, source_type, title, summary, 
            relevance_score, confidence_score, timestamp
        ) VALUES (
            'regulatory', 'EPRA', 'Regulatory',
            'Official Price Adjustment: ' || p_fuel_type,
            'EPRA has officially updated the retail price for ' || p_fuel_type || ' to KES ' || p_new_price || '. Effective immediately.',
            1.0, 1.0, now()
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
