#!/usr/bin/env bash
# Issue a hardware (device) JWT for local firmware flashing.
#
# Primary path: calls the deployed `issue-device-token` Edge Function as the
# station admin, mirroring production. Requires `supabase functions serve`
# (or a deployed function) and a tank that exists for the station.
#
# Usage:
#   scripts/issue-device-token.sh [TANK_ID] [STATION_ID]
#
# Env overrides (defaults target `supabase start`):
#   SUPABASE_URL (http://127.0.0.1:54321)
#   SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
#   IOTANK_ADMIN_EMAIL (admin@iotank.local) / IOTANK_ADMIN_PASSWORD (test1234)
set -euo pipefail

BASE="${SUPABASE_URL:-http://127.0.0.1:54321}"
ANON="${SUPABASE_ANON_KEY:-sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH}"
SERVICE="${SUPABASE_SERVICE_ROLE_KEY:-sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz}"
EMAIL="${IOTANK_ADMIN_EMAIL:-admin@iotank.local}"
PASSWORD="${IOTANK_ADMIN_PASSWORD:-test1234}"

TANK_ARG="${1:-}"
STATION_ARG="${2:-}"

echo "==> Authenticating ${EMAIL}"
ACCESS_TOKEN=$(curl -sS -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))")

if [ -z "$ACCESS_TOKEN" ]; then
  echo "  ERROR: login failed. Run scripts/dev-setup.sh first." >&2
  exit 1
fi
echo "  ok"

svc_get() { curl -sS "$BASE/rest/v1/$1" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Accept: application/json"; }

if [ -z "$STATION_ARG" ]; then
  STATION_ARG=$(curl -sS "$BASE/rest/v1/profiles?select=station_id&auth_user_id=eq.$(curl -sS "$BASE/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $ACCESS_TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")" \
    -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print((d[0]['station_id'] if d else '') or '')" 2>/dev/null || true)
fi

if [ -z "$STATION_ARG" ]; then
  echo "  ERROR: could not resolve station_id; pass it as the 2nd argument." >&2
  exit 1
fi

if [ -z "$TANK_ARG" ]; then
  TANK_ARG=$(svc_get "tanks?select=id&station_id=eq.$STATION_ARG&limit=1" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
fi

if [ -z "$TANK_ARG" ]; then
  echo "==> No tank for station $STATION_ARG — provisioning a demo tank"
  TANK_ARG=$(curl -sS -X POST "$BASE/rest/v1/tanks" \
    -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    -d "{\"station_id\":\"$STATION_ARG\",\"tank_name\":\"Demo Tank\",\"fuel_type\":\"diesel\",\"tank_capacity\":10000,\"status\":\"active\"}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) and d else '')")
fi

echo "==> Issuing device token (station=$STATION_ARG tank=$TANK_ARG)"
RESP=$(curl -sS -X POST "$BASE/functions/v1/issue-device-token" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"tankId\":\"$TANK_ARG\",\"stationId\":\"$STATION_ARG\"}" 2>/dev/null || true)

TOKEN=$(echo "$RESP" | python3 -c "import sys,json
try:
    d=json.load(sys.stdin); print(d.get('token',''))
except Exception:
    print('')" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  echo "  WARN: Edge Function unavailable — falling back to local signing." >&2
  echo "        (run \"supabase functions serve --env-file supabase/functions/.env\" for the production path)" >&2
  JWT_SECRET="${JWT_SECRET:-$(grep -E '^JWT_SECRET=' supabase/functions/.env 2>/dev/null | cut -d= -f2- || true)}"
  JWT_SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
  TOKEN=$(JWT_SECRET="$JWT_SECRET" STATION="$STATION_ARG" TANK="$TANK_ARG" python3 -c "
import os,hmac,hashlib,base64,json,time
def b64(x): return base64.urlsafe_b64encode(x).rstrip(b'=')
sec=os.environ['JWT_SECRET'].encode()
now=int(time.time())
h=b64(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())
p=b64(json.dumps({'role':'device','station_id':os.environ['STATION'],'tank_id':os.environ['TANK'],'iat':now,'exp':now+60*60*24*365,'iss':'iotank-bridge-v2','aud':'authenticated'},separators=(',',':')).encode())
print((h+b'.'+p+b'.'+b64(hmac.new(sec,h+b'.'+p,hashlib.sha256).digest())).decode())")
fi

if [ -z "$TOKEN" ]; then
  echo "  ERROR: token generation failed" >&2
  exit 2
fi

printf '\n  token (len %d)\n\n  Paste into firmware:\n  #define DEVICE_JWT "%s"\n\n' "${#TOKEN}" "$TOKEN"
