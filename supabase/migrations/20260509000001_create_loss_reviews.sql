-- ============================================================
-- Migration: loss_reviews table for Variance Review Panel
-- IoTank V2.0.0
-- ============================================================

CREATE TABLE IF NOT EXISTS public.loss_reviews (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id          TEXT NOT NULL,
    reviewed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    date                DATE NOT NULL DEFAULT CURRENT_DATE,
    variance_liters     NUMERIC(10, 2) NOT NULL,
    pump_sales          NUMERIC(10, 2),
    tank_drawdown       NUMERIC(10, 2),
    estimated_value_kes NUMERIC(14, 2),
    selected_cause      TEXT NOT NULL CHECK (selected_cause IN (
                            'Delivery Adjustment',
                            'Shift ReconciliationGap',
                            'Meter Calibration',
                            'Tank Temperature Shift',
                            'Suspected Leak',
                            'Unknown'
                        )),
    explanation         TEXT,
    action_taken        TEXT NOT NULL CHECK (action_taken IN ('reviewed', 'escalated')),
    photo_url           TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast station-scoped queries
CREATE INDEX IF NOT EXISTS loss_reviews_station_id_idx ON public.loss_reviews(station_id, date DESC);

-- RLS: Enable row-level security
ALTER TABLE public.loss_reviews ENABLE ROW LEVEL SECURITY;

-- Policy: Use JWT claim pattern (same as other tables in this project)
-- This avoids any subquery on user profile tables and is safe against recursion.
DROP POLICY IF EXISTS "loss_reviews_station_access" ON public.loss_reviews;
CREATE POLICY "loss_reviews_station_access"
ON public.loss_reviews
FOR ALL
USING ((auth.jwt() ->> 'station_id')::text = station_id)
WITH CHECK ((auth.jwt() ->> 'station_id')::text = station_id);

-- Grant permissions
GRANT SELECT, INSERT ON public.loss_reviews TO authenticated;
