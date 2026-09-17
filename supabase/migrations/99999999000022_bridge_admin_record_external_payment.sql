-- Bridge: admin panel calls public.admin_record_external_payment(p_station_id,
-- p_amount, p_method, p_reference) but the function was dropped by the
-- 20260423140000 dead-code prune and never re-created. Provide the
-- implementation the app expects.

CREATE OR REPLACE FUNCTION public.admin_record_external_payment(
    p_station_id UUID,
    p_amount     NUMERIC,
    p_method     TEXT,
    p_reference  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_provider     TEXT;
    v_inserted_id  UUID;
BEGIN
    -- Only staff may record external payments
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Unauthorized: staff access required';
    END IF;

    -- Normalize the provider value to fit the CHECK constraint
    v_provider := UPPER(TRIM(COALESCE(p_method, 'OTHERS')));
    IF v_provider NOT IN (
        'MPESA','PAYSTACK','CASH','BANK_TRANSFER','AIRTEL_MONEY','CARD',
        'MOBILE_MONEY','ONLINE','OTHERS'
    ) THEN
        v_provider := 'OTHERS';
    END IF;

    -- Record the payment
    INSERT INTO public.billing_transactions (
        station_id, amount, provider, provider_ref, status
    ) VALUES (
        p_station_id, p_amount, v_provider, p_reference, 'COMPLETED'
    )
    RETURNING id INTO v_inserted_id;

    -- Adjust station balances
    UPDATE public.fuel_stations
       SET total_paid   = COALESCE(total_paid, 0) + p_amount,
           current_debt = GREATEST(COALESCE(current_debt, 0) - p_amount, 0),
           last_payment_date = NOW(),
           updated_at   = NOW()
     WHERE station_id = p_station_id;

    RETURN jsonb_build_object(
        'success',      true,
        'transaction_id', v_inserted_id,
        'amount',       p_amount,
        'provider',     v_provider
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_record_external_payment(uuid, numeric, text, text) TO authenticated;
