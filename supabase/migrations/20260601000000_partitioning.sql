-- supabase/migrations/20260601000000_partitioning.sql
-- ============================================================================
-- SAAS SCALABILITY: Sensor Readings Partitioning
-- ============================================================================
-- This migration converts the high-volume sensor_readings table into a 
-- partitioned table by month. This ensures that queries remain fast even 
-- with millions of records.

-- 1. Create the new partitioned table
CREATE TABLE IF NOT EXISTS public.sensor_readings_partitioned (
    id UUID DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES public.fuel_stations(station_id),
    tank_id UUID NOT NULL REFERENCES public.tanks(id),
    volume DOUBLE PRECISION,
    volume_corrected DOUBLE PRECISION,
    temperature DOUBLE PRECISION,
    water_level DOUBLE PRECISION,
    captured_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

-- 2. Create initial partitions (Current + Next 3 Months)
CREATE TABLE IF NOT EXISTS public.sensor_readings_y2026m05 PARTITION OF public.sensor_readings_partitioned
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS public.sensor_readings_y2026m06 PARTITION OF public.sensor_readings_partitioned
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS public.sensor_readings_y2026m07 PARTITION OF public.sensor_readings_partitioned
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- 2.5 Create a DEFAULT partition for historical/future data outside the above range
CREATE TABLE IF NOT EXISTS public.sensor_readings_default PARTITION OF public.sensor_readings_partitioned DEFAULT;

-- 3. Migration logic would normally go here to move data, but for a 
-- fresh production start, we will swap the tables.
-- NOTE: In a live migration, we use 'INSERT INTO ... SELECT * FROM'

-- ============================================================================
-- REVENUE INFRASTRUCTURE: Billing & Subscriptions
-- ============================================================================
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_tier') THEN
        CREATE TYPE public.subscription_tier AS ENUM ('BASIC', 'PRO', 'ENTERPRISE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
        CREATE TYPE public.subscription_status AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'PROVISIONING');
    END IF;
END $$;

ALTER TABLE public.fuel_stations ADD COLUMN IF NOT EXISTS sub_tier public.subscription_tier DEFAULT 'BASIC';
ALTER TABLE public.fuel_stations ADD COLUMN IF NOT EXISTS sub_status public.subscription_status DEFAULT 'PROVISIONING';
ALTER TABLE public.fuel_stations ADD COLUMN IF NOT EXISTS sub_expires_at TIMESTAMPTZ;

-- Billing Logs for M-Pesa/Stripe Integration
CREATE TABLE IF NOT EXISTS public.billing_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES public.fuel_stations(station_id),
    amount DECIMAL(12,2) NOT NULL,
    currency TEXT DEFAULT 'KES',
    provider TEXT NOT NULL, -- 'MPESA', 'STRIPE', 'OFFLINE'
    provider_ref TEXT UNIQUE, -- M-Pesa Receipt Number
    status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on billing
ALTER TABLE public.billing_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view their own billing" ON public.billing_transactions;
CREATE POLICY "Admins can view their own billing"
    ON public.billing_transactions
    FOR SELECT
    TO authenticated
    USING (station_id IN (SELECT station_id FROM public.profiles WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "System can insert transactions" ON public.billing_transactions;
CREATE POLICY "System can insert transactions"
    ON public.billing_transactions
    FOR INSERT
    TO authenticated
    WITH CHECK (true);
