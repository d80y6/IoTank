-- supabase/migrations/20260602000000_add_reorder_point_alert_type.sql
-- ============================================================================
-- MIGRATION: Add 'reorder_point' and 'reorder-point' alert types to check constraint.
-- ============================================================================

-- 1. Refresh the check constraint — drop & re-add with full list including reorder_point / reorder-point
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
        'reorder_point', 'reorder-point',
        
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

-- 2. Notify schema reload
NOTIFY pgrst, 'reload schema';
