-- supabase/migrations/20260427223000_fix_shift_and_alert_constraints.sql

-- 1. UPDATE shift_closures status constraint to allow 'NEEDS_REVIEW'
-- ============================================================================
ALTER TABLE public.shift_closures DROP CONSTRAINT IF EXISTS shift_closures_status_check;
ALTER TABLE public.shift_closures ADD CONSTRAINT shift_closures_status_check 
    CHECK (status IN ('BALANCED', 'OVER', 'SHORT', 'NEEDS_REVIEW'));

-- 2. Standardize Alert Types (Inclusive of legacy types to avoid migration failure)
-- ============================================================================
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_alert_type_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_alert_type_check 
    CHECK (alert_type IN (
        -- Operational
        'low-level', 'low_level', 'low_fuel', 'low-fuel',
        'low_level_critical', 'low_level_warning',
        'overfill', 'high_temperature', 'high-temperature',
        'sensor-failure', 'sensor_failure', 'sensor_offline', 'sensor-offline',
        'telemetry-gap', 'telemetry_gap', 'connectivity-lost', 'connectivity_lost',
        'anomaly', 'system_error', 'system-error', 'warning_high',
        
        -- Forensic
        'leak', 'leak-detected', 'leak_detected',
        'refill', 'refill-detected', 'refill_detected',
        'unauthorized-refill', 'unauthorized_refill',
        'theft', 'theft-detected', 'theft_detected',
        'delivery-variance', 'delivery_variance',
        'night_drawdown',
        
        -- Intelligence
        'market-news', 'market_news', 'regulatory-update', 'regulatory_update',
        'compliance-deadline', 'compliance_deadline', 'price_review', 'price-review',
        'composite', 'composite_supply_risk',
        'info', 'warning', 'error', 'critical', 'success', 'system',
        'shift_open', 'shift-open', 'shift_close', 'shift-close'
    ));

-- 3. Relax severity constraint
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_severity_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_severity_check 
    CHECK (severity IN ('low', 'medium', 'high', 'critical', 'info', 'warning', 'watch'));
