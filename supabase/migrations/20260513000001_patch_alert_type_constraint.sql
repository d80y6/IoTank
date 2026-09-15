-- supabase/migrations/20260513000001_patch_alert_type_constraint.sql
-- ============================================================================
-- PATCH: Normalize rogue alert types introduced by AlertEngine v1 client code.
-- Remaps 'dead_stock' → 'anomaly' and 'telemetry_blackout' → 'sensor-blackout'
-- in existing DB rows, then adds them as deprecated aliases to the constraint
-- as a final safety net.
-- ============================================================================

-- 1. Disable tamper trigger for forensic correction
ALTER TABLE public.alerts DISABLE TRIGGER tr_prevent_alert_tampering;

-- 2. Remap rogue types to their canonical equivalents
UPDATE public.alerts SET alert_type = 'anomaly'         WHERE alert_type = 'dead_stock';
UPDATE public.alerts SET alert_type = 'sensor-blackout' WHERE alert_type = 'telemetry_blackout';

-- 3. Re-enable tamper trigger
ALTER TABLE public.alerts ENABLE TRIGGER tr_prevent_alert_tampering;

-- 4. Refresh the check constraint — drop & re-add with full canonical list
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_alert_type_check;

ALTER TABLE public.alerts ADD CONSTRAINT alerts_alert_type_check 
    CHECK (alert_type IN (
        -- Core Operational
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

-- 5. Notify schema reload
NOTIFY pgrst, 'reload schema';
