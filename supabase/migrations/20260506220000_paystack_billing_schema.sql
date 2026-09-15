-- supabase/migrations/20260506220000_paystack_billing_schema.sql

-- ============================================================================
-- PAYSTACK BILLING & API INFRASTRUCTURE
-- ============================================================================

-- 1. Paystack Configuration (Per Station)
CREATE TABLE IF NOT EXISTS paystack_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES fuel_stations(station_id) ON DELETE CASCADE UNIQUE,
    test_secret_key TEXT,
    test_public_key TEXT,
    live_secret_key TEXT,
    live_public_key TEXT,
    is_live_mode BOOLEAN DEFAULT FALSE,
    webhook_secret TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Billing Customers (Mapped to Paystack)
CREATE TABLE IF NOT EXISTS billing_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES fuel_stations(station_id) ON DELETE CASCADE,
    paystack_customer_code TEXT UNIQUE,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Billing Plans
CREATE TABLE IF NOT EXISTS billing_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES fuel_stations(station_id) ON DELETE CASCADE,
    paystack_plan_code TEXT UNIQUE,
    name TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency TEXT DEFAULT 'KES',
    interval TEXT DEFAULT 'monthly' CHECK (interval IN ('daily', 'weekly', 'monthly', 'quarterly', 'annually')),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Billing Subscriptions
CREATE TABLE IF NOT EXISTS billing_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES fuel_stations(station_id) ON DELETE CASCADE,
    customer_id UUID REFERENCES billing_customers(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES billing_plans(id) ON DELETE CASCADE,
    paystack_subscription_code TEXT UNIQUE,
    status TEXT DEFAULT 'active',
    next_payment_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Internal API Keys (For IoTank API Access)
CREATE TABLE IF NOT EXISTS internal_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES fuel_stations(station_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL, -- pk_live_ or pk_test_
    hashed_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS POLICIES
ALTER TABLE paystack_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_api_keys ENABLE ROW LEVEL SECURITY;

-- Utility function for station_id check (re-using existing pattern)
DROP POLICY IF EXISTS "Station owners can manage their Paystack config" ON paystack_config;
CREATE POLICY "Station owners can manage their Paystack config"
    ON paystack_config FOR ALL
    USING (station_id = get_station_id_from_auth() OR is_admin());

DROP POLICY IF EXISTS "Station owners can manage their billing customers" ON billing_customers;
CREATE POLICY "Station owners can manage their billing customers"
    ON billing_customers FOR ALL
    USING (station_id = get_station_id_from_auth() OR is_admin());

DROP POLICY IF EXISTS "Station owners can manage their billing plans" ON billing_plans;
CREATE POLICY "Station owners can manage their billing plans"
    ON billing_plans FOR ALL
    USING (station_id = get_station_id_from_auth() OR is_admin());

DROP POLICY IF EXISTS "Station owners can manage their billing subscriptions" ON billing_subscriptions;
CREATE POLICY "Station owners can manage their billing subscriptions"
    ON billing_subscriptions FOR ALL
    USING (station_id = get_station_id_from_auth() OR is_admin());

DROP POLICY IF EXISTS "Station owners can manage their internal API keys" ON internal_api_keys;
CREATE POLICY "Station owners can manage their internal API keys"
    ON internal_api_keys FOR ALL
    USING (station_id = get_station_id_from_auth() OR is_admin());

-- Seed initial config for the platform (if needed, but usually done via UI)

-- 6. Process Payment Stored Procedure
CREATE OR REPLACE FUNCTION public.process_payment(
    p_station_id UUID,
    p_amount DECIMAL,
    p_payment_method TEXT,
    p_payment_reference TEXT,
    p_description TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_old_debt DECIMAL;
    v_new_debt DECIMAL;
BEGIN
    -- 1. Fetch current debt
    SELECT current_debt INTO v_old_debt
    FROM fuel_stations
    WHERE station_id = p_station_id;

    IF v_old_debt IS NULL THEN
        RAISE EXCEPTION 'Station with ID % not found', p_station_id;
    END IF;

    -- 2. Calculate new debt (Floor at 0)
    v_new_debt := GREATEST(0, v_old_debt - p_amount);

    -- 3. Update Station Ledger
    UPDATE fuel_stations
    SET current_debt = v_new_debt,
        total_paid = total_paid + p_amount,
        updated_at = NOW()
    WHERE station_id = p_station_id;

    -- 4. Record Transaction
    INSERT INTO transactions (
        station_id,
        transaction_type,
        amount,
        description,
        payment_method,
        payment_reference,
        payment_status,
        created_at,
        completed_at
    ) VALUES (
        p_station_id,
        'payment',
        p_amount,
        p_description,
        p_payment_method,
        p_payment_reference,
        'completed',
        NOW(),
        NOW()
    );

    -- 5. Record Audit Event
    INSERT INTO unified_events (
        station_id,
        event_category,
        event_type,
        description,
        metadata
    ) VALUES (
        p_station_id,
        'FINANCE',
        'PAYMENT_RECEIVED',
        'Payment of KSh ' || p_amount || ' received via ' || p_payment_method,
        jsonb_build_object(
            'amount', p_amount,
            'method', p_payment_method,
            'reference', p_payment_reference,
            'new_debt', v_new_debt
        )
    );
END;
$$;
