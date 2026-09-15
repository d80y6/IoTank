-- supabase/seed.sql
-- Requires auth user 'admin@iotank.local' to exist (created via Admin API).

DO $$
DECLARE
    v_email        TEXT := 'admin@iotank.local';
    v_display_name TEXT := 'Test Super Admin';
    v_auth_id      UUID;
    v_station_id   UUID;
BEGIN
    SELECT id INTO v_auth_id FROM auth.users WHERE email = v_email;
    IF v_auth_id IS NULL THEN
        RAISE NOTICE 'Auth user % not found. Create it via Admin API first.', v_email;
        RETURN;
    END IF;

    -- 1. fuel_stations (tenant)
    SELECT station_id INTO v_station_id
    FROM public.fuel_stations WHERE email = v_email;

    IF v_station_id IS NULL THEN
        INSERT INTO public.fuel_stations (
            email, station_name, station_location, county,
            auth_user_id, owner_id,
            sub_status, sub_tier, account_status, subscription_status
        ) VALUES (
            v_email, 'Test Station', 'Nairobi', 'Nairobi',
            v_auth_id, v_auth_id,
            'TRIAL'::subscription_status, 'BASIC'::subscription_tier,
            'active', 'active'
        )
        RETURNING station_id INTO v_station_id;
    END IF;

    -- 2. profiles (tenant-scoped)
    INSERT INTO public.profiles (
        auth_user_id, email, display_name, role, station_id
    ) VALUES (
        v_auth_id, v_email, v_display_name, 'owner', v_station_id
    )
    ON CONFLICT (auth_user_id) DO UPDATE
        SET station_id   = EXCLUDED.station_id,
            email        = EXCLUDED.email,
            role         = EXCLUDED.role,
            display_name = EXCLUDED.display_name;

    -- 3. system_users (staff; super_admin requires auth_user_id set)
    INSERT INTO public.system_users (
        auth_user_id, email, display_name, role, is_active
    ) VALUES (
        v_auth_id, v_email, v_display_name, 'super_admin', TRUE
    )
    ON CONFLICT (email) DO UPDATE
        SET auth_user_id = EXCLUDED.auth_user_id,
            role         = EXCLUDED.role,
            is_active    = TRUE,
            display_name = EXCLUDED.display_name;

    RAISE NOTICE 'Seed complete. station_id=% auth_user_id=%', v_station_id, v_auth_id;
END $$;
