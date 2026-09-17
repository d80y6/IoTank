-- Bridge: defines public.reconcile_financial_trails() used by the Super Admin
-- Audit & Compliance console. The client calls this RPC with no arguments.
CREATE OR REPLACE FUNCTION public.reconcile_financial_trails()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_total   bigint;
    v_credits bigint;
    v_debits  bigint;
    v_pending bigint;
    v_failed  bigint;
    v_net     numeric;
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Unauthorized: staff access required';
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE transaction_type IN ('payment', 'credit', 'discount', 'refund')),
        COUNT(*) FILTER (WHERE transaction_type IN ('charge', 'usage_charge', 'penalty', 'adjustment')),
        COUNT(*) FILTER (WHERE payment_status = 'pending'),
        COUNT(*) FILTER (WHERE payment_status = 'failed'),
        COALESCE(SUM(amount), 0)
    INTO v_total, v_credits, v_debits, v_pending, v_failed, v_net
    FROM public.transactions;

    RETURN jsonb_build_object(
        'success', true,
        'records', v_total,
        'credits', v_credits,
        'debits', v_debits,
        'pending', v_pending,
        'failed', v_failed,
        'net', v_net,
        'reconciled_at', now()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_financial_trails() TO authenticated;
