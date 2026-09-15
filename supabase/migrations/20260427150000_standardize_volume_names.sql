-- supabase/migrations/20260427150000_standardize_volume_names.sql

-- 1. Standardize daily_summaries column name
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'daily_summaries' AND column_name = 'avg_ambient_volume'
    ) THEN
        ALTER TABLE public.daily_summaries RENAME COLUMN avg_ambient_volume TO avg_volume;
    END IF;
END $$;

-- 2. Update standard_volume calculation logic for deliveries (Refinement)
-- The user mentioned this is for the "Add Delivery" modal.
-- We keep standard_volume as a specific metric for VCF at 15.5°C.
-- But we ensure the term 'volume' refers to the primary observed volume.

-- 3. Ensure sensor_readings has 'volume' and not 'ambient_volume'
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sensor_readings' AND column_name = 'ambient_volume'
    ) THEN
        ALTER TABLE public.sensor_readings RENAME COLUMN ambient_volume TO volume;
    END IF;
END $$;

-- 4. Add missing smoothing columns to tanks table
ALTER TABLE public.tanks ADD COLUMN IF NOT EXISTS last_smoothed_level DECIMAL(10,2);
ALTER TABLE public.tanks ADD COLUMN IF NOT EXISTS filter_covariance DECIMAL(10,6) DEFAULT 1.0;
ALTER TABLE public.tanks ADD COLUMN IF NOT EXISTS outlier_count INTEGER DEFAULT 0;

