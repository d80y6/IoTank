-- supabase/migrations/20260512000002_expand_alert_types.sql
-- ============================================================================
-- EXPAND ALERT TYPES: Add SENSOR-BLACKOUT and standardizing existing types
-- ============================================================================

-- 1. Update the check constraint to include new forensic types
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_alert_type_check;

ALTER TABLE public.alerts ADD CONSTRAINT alerts_alert_type_check 
    CHECK (alert_type IN (
        -- Core Operational (Dashed & Underscore)
        'low-level', 'low_level', 'low_fuel', 'low-fuel',
        'low_level_critical', 'low_level_warning',
        'overfill', 'high_temperature', 'high-temperature',
        'sensor-failure', 'sensor_failure', 'sensor_offline', 'sensor-offline',
        'telemetry-gap', 'telemetry_gap', 'connectivity-lost', 'connectivity_lost',
        'anomaly', 'system_error', 'system-error', 'sensor-blackout', 'sensor_blackout',
        'calibration_due', 'calibration-due', 'payment_overdue', 'payment-overdue',
        'warning_high', 'warning-high',
        
        -- Forensic & Security
        'leak', 'leak-detected', 'leak_detected',
        'refill', 'refill-detected', 'refill_detected',
        'unauthorized-refill', 'unauthorized_refill',
        'theft', 'theft-detected', 'theft_detected',
        'night_drawdown', 'night-drawdown',
        
        -- Intelligence & Compliance
        'market-news', 'market_news',
        'regulatory-update', 'regulatory_update',
        'delivery-variance', 'delivery_variance',
        'compliance-deadline', 'compliance_deadline',
        'price_review', 'price-review',
        'composite', 'composite_supply_risk',
        
        -- UI & System Support
        'info', 'warning', 'error', 'critical', 'success', 'system',
        'maintenance', 'test', 'operational-alert', 'operational_alert',
        'delivery', 'delivery_added', 'delivery-added',
        'shift_open', 'shift-open', 'shift_close', 'shift-close'
    ));

-- 2. Update severity constraint to include 'watch'
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_severity_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_severity_check 
    CHECK (severity IN ('low', 'medium', 'high', 'critical', 'info', 'warning', 'watch'));

-- 3. Forensic Fix: Standardize types (Temporarily bypass tamper trigger)
ALTER TABLE public.alerts DISABLE TRIGGER tr_prevent_alert_tampering;

UPDATE public.alerts SET alert_type = 'connectivity-lost' WHERE alert_type = 'connectivity_lost';
UPDATE public.alerts SET alert_type = 'sensor-blackout' WHERE alert_type = 'sensor_blackout';
UPDATE public.alerts SET alert_type = 'sensor-failure' WHERE alert_type = 'sensor_failure';

ALTER TABLE public.alerts ENABLE TRIGGER tr_prevent_alert_tampering;

-- 4. Notify schema change
NOTIFY pgrst, 'reload schema';
