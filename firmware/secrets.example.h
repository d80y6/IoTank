// Copy this file to 'secrets.h' and fill the values. Do NOT commit 'secrets.h'.

#ifndef SECRETS_H
#define SECRETS_H

// --- Shared identities (used by IoTank_ESP32_Template) ---
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Supabase project URL and anon key (use device JWT for authenticated device requests)
#define SUPABASE_URL "https://your-project.supabase.co"
#define SUPABASE_ANON_KEY "your_supabase_anon_key_here"
#define DEVICE_JWT "your_device_jwt_here"

#define STATION_ID "YOUR_STATION_UUID"
#define TANK_ID "YOUR_TANK_UUID"

// --- Legacy sketches (Frustum_Content_Monitor, supabase_simulation) ---
// These post straight to the REST endpoint, so SUPABASE_URL is the full path.
#define SECRET_WIFI_SSID "YOUR_WIFI_SSID"
#define SECRET_WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define SECRET_SUPABASE_URL "https://your-project.supabase.co/rest/v1/sensor_readings"
// DANGER: keep this in firmware/secrets.h only. Preferred: a device-scoped
// hardware JWT from the Super Admin portal instead of the service-role key.
#define SECRET_SUPABASE_SERVICE_ROLE_KEY "your_service_role_key_here"
#define SECRET_STATION_ID "YOUR_STATION_UUID"
#define SECRET_TANK_ID "YOUR_TANK_UUID"

#endif // SECRETS_H
