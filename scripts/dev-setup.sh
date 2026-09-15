#!/usr/bin/env bash
set -euo pipefail

ANON="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
SERVICE="sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz"
BASE="http://127.0.0.1:54321"
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
EMAIL="admin@iotank.local"
PASSWORD="test1234"

echo "==> Creating auth user"
curl -sS -X POST "$BASE/auth/v1/admin/users" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"display_name\":\"Test Super Admin\"}}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('  auth id:', d.get('id') or d.get('msg'))"

echo "==> Provisioning profile + station + super_admin"
psql "$DB" -v ON_ERROR_STOP=1 <<SQL
ALTER TABLE public.profiles DISABLE TRIGGER tr_protect_profile_fields;
ALTER TABLE public.profiles DISABLE TRIGGER tr_protect_profile_sensitive_columns;

DO \$\$
DECLARE
    v_email TEXT := '$EMAIL';
    v_auth_id UUID;
    v_station_id UUID;
BEGIN
    SELECT id INTO v_auth_id FROM auth.users WHERE email = v_email;
    IF v_auth_id IS NULL THEN RAISE EXCEPTION 'auth user missing — check Admin API call'; END IF;

    SELECT station_id INTO v_station_id FROM public.fuel_stations WHERE email = v_email;
    IF v_station_id IS NULL THEN
        INSERT INTO public.fuel_stations (email, station_name, station_location, county,
            auth_user_id, owner_id, sub_status, sub_tier, account_status, subscription_status)
        VALUES (v_email, 'Test Station', 'Nairobi', 'Nairobi', v_auth_id, v_auth_id,
            'TRIAL'::subscription_status, 'BASIC'::subscription_tier, 'active', 'active')
        RETURNING station_id INTO v_station_id;
    END IF;

    INSERT INTO public.profiles (auth_user_id, email, display_name, role, station_id)
    VALUES (v_auth_id, v_email, 'Test Super Admin', 'owner', v_station_id)
    ON CONFLICT (auth_user_id) DO UPDATE
        SET station_id = EXCLUDED.station_id, role = 'owner', display_name = EXCLUDED.display_name;

    INSERT INTO public.system_users (auth_user_id, email, display_name, role, is_active)
    VALUES (v_auth_id, v_email, 'Test Super Admin', 'super_admin', TRUE)
    ON CONFLICT (email) DO UPDATE
        SET auth_user_id = EXCLUDED.auth_user_id, role = EXCLUDED.role, is_active = TRUE;

    RAISE NOTICE 'Provisioned auth_id=% station_id=%', v_auth_id, v_station_id;
END \$\$;

ALTER TABLE public.profiles ENABLE TRIGGER tr_protect_profile_sensitive_columns;
ALTER TABLE public.profiles ENABLE TRIGGER tr_protect_profile_fields;

SELECT 'profiles'     AS tbl, email, role FROM public.profiles     WHERE email = '$EMAIL'
UNION ALL
SELECT 'system_users', email, role FROM public.system_users WHERE email = '$EMAIL'
UNION ALL
SELECT 'fuel_stations', email, station_name FROM public.fuel_stations WHERE email = '$EMAIL';
SQL

echo "==> Verifying login"
curl -sS -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('  token len:', len(d.get('access_token','')), '| error:', d.get('msg') or 'none')"

echo "==> Done"
