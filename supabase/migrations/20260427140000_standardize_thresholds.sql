-- supabase/migrations/20260427140000_standardize_thresholds.sql

-- 1. Ensure market_signals has a default UUID if not provided
-- This prevents the 'id' field from being null during scraper insertions
ALTER TABLE public.market_signals 
ALTER COLUMN id SET DEFAULT gen_random_uuid()::TEXT;

-- 2. Standardize Thresholds in logic (Check constraints on tanks)
-- Existing tanks might have different thresholds; we ensure the schema allows our new 5/20/95/98 standards
DO $$ 
BEGIN
    -- Ensure status labels are consistent with UI
    -- We don't drop existing ones to prevent data loss, but we ensure the constraints match our logic
    ALTER TABLE public.tanks DROP CONSTRAINT IF EXISTS tanks_status_check;
    ALTER TABLE public.tanks ADD CONSTRAINT tanks_status_check 
        CHECK (status IN ('active', 'inactive', 'maintenance', 'decommissioned', 'idle', 'pumping', 'offline'));
END $$;

-- 3. Ensure forensic_update_market_price is consolidated
-- We will replace the previous one with a definitive version in the next step
