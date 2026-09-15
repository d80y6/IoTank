-- supabase/migrations/20260601000002_allow_paystack_method.sql
-- ============================================================================
-- BILLING HARDENING: Expand Allowed Payment Methods (CORRECTED)
-- ============================================================================

DO $$ 
BEGIN
    -- 1. Update billing_transactions (Uses 'provider' column)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'billing_transactions' AND column_name = 'provider') THEN
        ALTER TABLE public.billing_transactions DROP CONSTRAINT IF EXISTS billing_transactions_provider_check;
        ALTER TABLE public.billing_transactions 
        ADD CONSTRAINT billing_transactions_provider_check 
        CHECK (provider IN ('MPESA', 'PAYSTACK', 'CASH', 'BANK_TRANSFER', 'AIRTEL_MONEY'));
    END IF;
    
    -- 2. Update legacy transactions (Uses 'payment_method' column)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'payment_method') THEN
        ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
        ALTER TABLE public.transactions 
        ADD CONSTRAINT transactions_payment_method_check 
        CHECK (payment_method IN ('MPESA', 'PAYSTACK', 'CASH', 'BANK_TRANSFER', 'AIRTEL_MONEY'));
    END IF;
END $$;
