-- supabase/migrations/20260507000002_audit_immutability.sql
-- ============================================================================
-- FOR ENSIC INTEGRITY: Audit Log Immutability
-- ============================================================================
-- This trigger ensures that once a record is written to unified_events,
-- it can NEVER be updated or deleted, even by an authenticated super admin.
-- This provides a high-trust tamper-proof ledger for station operations.

CREATE OR REPLACE FUNCTION public.prevent_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Forensic Integrity Violation: Audit logs (unified_events) are immutable and cannot be modified or deleted.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply to unified_events
DROP TRIGGER IF EXISTS tr_audit_immutability ON public.unified_events;
CREATE TRIGGER tr_audit_immutability
BEFORE UPDATE OR DELETE ON public.unified_events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_tampering();

-- ============================================================================
-- ADD Manual Override column to shift_closures
-- ============================================================================
-- This allows us to track if a shift was opened via sensor data or manual dip-stick
ALTER TABLE public.shift_closures ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN DEFAULT FALSE;
ALTER TABLE public.shift_closures ADD COLUMN IF NOT EXISTS manual_override_reason TEXT;
