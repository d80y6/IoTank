-- Bridge: admin panel's clientsService.ts calls five RPCs that were dropped
-- by the 20260423140000 dead-code prune. Re-implement with the shapes the
-- app expects. All gate on check_is_staff() (super_admin, admin_helper,
-- support_staff, analyst all pass).

-- 1. admin_adjust_station_debt(p_station_id UUID, p_adjustment_amount DECIMAL, p_reason TEXT)
CREATE OR REPLACE FUNCTION public.admin_adjust_station_debt(
    p_station_id        UUID,
    p_adjustment_amount DECIMAL,
    p_reason            TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_row public.fuel_stations;
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Unauthorized: staff access required';
    END IF;

    UPDATE public.fuel_stations
       SET current_debt = GREATEST(COALESCE(current_debt, 0) + p_adjustment_amount, 0),
           updated_at   = NOW()
     WHERE station_id = p_station_id
    RETURNING * INTO v_row;

    IF v_row IS NULL THEN
        RAISE EXCEPTION 'Station % not found', p_station_id;
    END IF;

    -- Audit trail
    INSERT INTO public.unified_events (station_id, event_category, event_type, description, severity, metadata)
    VALUES (p_station_id, 'BILLING', 'DEBT_ADJUSTED',
            COALESCE(p_reason, 'Manual debt adjustment'),
            'INFO',
            jsonb_build_object('adjustment', p_adjustment_amount, 'new_debt', v_row.current_debt));

    RETURN jsonb_build_object('success', true, 'new_debt', v_row.current_debt);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_station_debt(uuid, numeric, text) TO authenticated;

-- 2. admin_suspend_station(p_station_id UUID, p_reason TEXT)
CREATE OR REPLACE FUNCTION public.admin_suspend_station(
    p_station_id UUID,
    p_reason     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Unauthorized: staff access required';
    END IF;

    UPDATE public.fuel_stations
       SET account_status    = 'suspended',
           suspension_reason = p_reason,
           updated_at        = NOW()
     WHERE station_id = p_station_id;

    INSERT INTO public.unified_events (station_id, event_category, event_type, description, severity, metadata)
    VALUES (p_station_id, 'SYSTEM', 'ACCOUNT_SUSPENDED',
            COALESCE(p_reason, 'Suspended by admin'), 'WARNING',
            jsonb_build_object('reason', p_reason));

    RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_suspend_station(uuid, text) TO authenticated;

-- 3. admin_record_external_payment(p_station_id UUID, p_amount NUMERIC, p_method TEXT, p_reference TEXT)
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
    v_provider    TEXT;
    v_inserted_id UUID;
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Unauthorized: staff access required';
    END IF;

    v_provider := UPPER(TRIM(COALESCE(p_method, 'OTHERS')));
    IF v_provider NOT IN (
        'MPESA','PAYSTACK','CASH','BANK_TRANSFER','AIRTEL_MONEY','CARD',
        'MOBILE_MONEY','ONLINE','OTHERS'
    ) THEN
        v_provider := 'OTHERS';
    END IF;

    INSERT INTO public.billing_transactions
        (station_id, amount, provider, provider_ref, status)
    VALUES
        (p_station_id, p_amount, v_provider, p_reference, 'COMPLETED')
    RETURNING id INTO v_inserted_id;

    UPDATE public.fuel_stations
       SET total_paid        = COALESCE(total_paid, 0) + p_amount,
           current_debt      = GREATEST(COALESCE(current_debt, 0) - p_amount, 0),
           last_payment_date = NOW(),
           updated_at        = NOW()
     WHERE station_id = p_station_id;

    RETURN jsonb_build_object('success', true, 'transaction_id', v_inserted_id,
                              'amount', p_amount, 'provider', v_provider);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_record_external_payment(uuid, numeric, text, text) TO authenticated;

-- 4. admin_update_station_profile(p_station_id UUID, p_updates JSONB)
CREATE OR REPLACE FUNCTION public.admin_update_station_profile(
    p_station_id UUID,
    p_updates    JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_row public.fuel_stations;
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Unauthorized: staff access required';
    END IF;

    UPDATE public.fuel_stations
       SET station_name     = COALESCE(p_updates->>'station_name',     station_name),
           email            = COALESCE(p_updates->>'email',            email),
           phone            = COALESCE(p_updates->>'phone',            phone),
           station_location = COALESCE(p_updates->>'station_location', station_location),
           county           = COALESCE(p_updates->>'county',           county),
           logo_url         = COALESCE(p_updates->>'logo_url',         logo_url),
           updated_at       = NOW()
     WHERE station_id = p_station_id
    RETURNING * INTO v_row;

    IF v_row IS NULL THEN
        RAISE EXCEPTION 'Station % not found', p_station_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'station', to_jsonb(v_row));
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_station_profile(uuid, jsonb) TO authenticated;

-- 5. admin_reactivate_station(p_station_id UUID)
CREATE OR REPLACE FUNCTION public.admin_reactivate_station(
    p_station_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.check_is_staff() THEN
        RAISE EXCEPTION 'Unauthorized: staff access required';
    END IF;

    UPDATE public.fuel_stations
       SET account_status    = 'active',
           suspension_reason = NULL,
           updated_at        = NOW()
     WHERE station_id = p_station_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_station(uuid) TO authenticated;
