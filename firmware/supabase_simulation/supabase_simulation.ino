/**
 * ============================================================
 *  Tank   : Petrol Storage 1 | 4000L capacity
 *  Org ID : Managed via DB (Station ID updated by user)
 *  Tank ID: Managed via DB (Tank ID updated by user)
 * ============================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <esp_random.h>
#include <math.h>

// ─── Secrets (from firmware/secrets.h — NOT committed) ──────
#include "secrets.h"

// ─── WiFi Configuration ──────────────────────────────────────
const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;

// ─── Supabase Configuration ─────────────────────────────────
const char* SUPABASE_URL              = SECRET_SUPABASE_URL;
const char* SUPABASE_SERVICE_ROLE_KEY = SECRET_SUPABASE_SERVICE_ROLE_KEY;

// ─── ID Configuration ───────────────────────────────────────
// These will be updated by the user from the Super Admin Portal
const char* STATION_ID = SECRET_STATION_ID; 
const char* TANK_ID    = SECRET_TANK_ID;

// Hardware JWT placeholder
const char* SECURE_DEVICE_TOKEN = "PASTE_YOUR_HARDWARE_JWT_HERE"; 

// ─── Tank Configuration ──────────────────────────────────────
#define TANK_CAPACITY       4000.0f
#define TANK_START_MIN      400.0f    // 10% (Triggers low fuel warning)
#define TANK_START_MAX      1200.0f   // 30%
#define LOW_FUEL_THRESHOLD  800.0f    // 20% (Standard reorder point)
#define CRITICAL_THRESHOLD  200.0f    // 5% (Dead stock breach)

// ─── Pump / Dispense Configuration ──────────────────────────
#define DISPENSE_RATE_LPS    1.0f      // 60 L/min
#define DB_WRITE_INTERVAL_MS 5000      // Log every 5L (5s) for "Live" feel
#define DB_WRITE_CHUNK       5.0f

// ─── Refill Configuration ────────────────────────────────────
#define REFILL_RATE_LPS     5.0f       // 300 L/min
#define REFILL_INTERVAL_MS  2000       // Log every 10L (2s)
#define REFILL_CHUNK        10.0f

// ─── Temperature Simulation ──────────────────────────────────
#define TEMP_BASE_MIN       22.0f
#define TEMP_BASE_MAX       34.0f
#define TEMP_NOISE          0.4f
#define TEMP_CRITICAL       60.0f      // Alert Threshold

// ─── State ───────────────────────────────────────────────────
float tankLevel      = 0.0f;
float totalDispensed = 0.0f;
int   dispenseCount  = 0;
float currentTemp    = 28.0f;
int   currentRSSI    = -65;
unsigned long elapsedSec = 0;

// ─── Vehicle Types ──────────────────────────────────────────
struct VehicleType {
  const char* name;
  int         minLitres;
  int         maxLitres;
  float       probability;
};

const VehicleType VEHICLES[] = {
  { "Motorbike",       5,  15, 0.30f },
  { "Car",            20,  45, 0.55f },
  { "Transit/Matatu", 45,  100, 0.15f } // Increased for 4000L tank context
};
const int VEHICLE_COUNT = 3;

// ─── Supabase Push Function ─────────────────────────────────
void pushToSupabase(float vol, float temp, int rssi) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("  ⚠ WiFi disconnected. Skipping push."));
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); 

  HTTPClient http;
  http.begin(client, SUPABASE_URL);
  
  http.addHeader("Content-Type", "application/json");

  String activeToken = String(SECURE_DEVICE_TOKEN);
  if (activeToken == "PASTE_YOUR_HARDWARE_JWT_HERE" || activeToken.length() < 10) {
    activeToken = String(SUPABASE_SERVICE_ROLE_KEY);
  }

  http.addHeader("apikey", activeToken);
  String authHeader = "Bearer " + activeToken;
  http.addHeader("Authorization", authHeader);
  http.addHeader("Prefer", "return=minimal");

  // Payload matches the partitioned sensor_readings schema (volume, temperature;
  // rssi travels inside metadata since the partitioned table has no rssi column)
  String jsonPayload = "{\"station_id\": \"" + String(STATION_ID) + 
                       "\", \"tank_id\": \"" + String(TANK_ID) + 
                       "\", \"volume\": " + String(vol, 2) + 
                       ", \"temperature\": " + String(temp, 2) + 
                       ", \"metadata\": {\"rssi\": " + String(rssi) + "}}";

  int httpResponseCode = http.POST(jsonPayload);

  if (httpResponseCode >= 200 && httpResponseCode <= 299) {
    Serial.printf("  [Supabase] Push Success: %.1fL | %.1fC | %ddBm\n", vol, temp, rssi);
  } else {
    Serial.printf("  [Supabase] Error: (HTTP %d) %s\n", httpResponseCode, http.getString().c_str());
  }
  
  http.end();
}

// ─── Helpers ────────────────────────────────────────────────
float randFloat(float lo, float hi) {
  return lo + ((float)random(0, 10000) / 10000.0f) * (hi - lo);
}

float simulateTemp(unsigned long sec) {
  float hour = fmod((float)sec / 3600.0f, 24.0f);
  float sine = sin((hour - 6.0f) * PI / 12.0f);
  float base = TEMP_BASE_MIN + (TEMP_BASE_MAX - TEMP_BASE_MIN) * ((sine + 1.0f) / 2.0f);
  return base + randFloat(-TEMP_NOISE, TEMP_NOISE);
}

const VehicleType& pickVehicle() {
  float r = randFloat(0.0f, 1.0f);
  float cumulative = 0.0f;
  for (int i = 0; i < VEHICLE_COUNT - 1; i++) {
    cumulative += VEHICLES[i].probability;
    if (r < cumulative) return VEHICLES[i];
  }
  return VEHICLES[VEHICLE_COUNT - 1];
}

// ─── Anomaly Engine ─────────────────────────────────────────

void simulateTheft() {
  Serial.println(F("\n🚨 ANOMALY: Rapid Drawdown (Theft Simulation)"));
  float theftVol = randFloat(30, 80);
  int steps = 5;
  float chunk = theftVol / steps;
  
  for(int i=0; i<steps; i++) {
    tankLevel -= chunk;
    if (tankLevel < 0) tankLevel = 0;
    pushToSupabase(tankLevel, currentTemp, currentRSSI);
    delay(2000); // Very fast drop to trigger theft logic
  }
}

void simulateHeatwave() {
  Serial.println(F("\n🔥 ANOMALY: Temperature Spike (Safety Alert)"));
  float spikeTemp = randFloat(62.0, 75.0);
  pushToSupabase(tankLevel, spikeTemp, currentRSSI);
  delay(5000);
}

void simulateConnectivityDrop() {
  Serial.println(F("\n📡 ANOMALY: Signal Degradation (Weak RSSI)"));
  int weakRSSI = random(-95, -88);
  pushToSupabase(tankLevel, currentTemp, weakRSSI);
  delay(5000);
}

// ─── Main Simulation Logic ──────────────────────────────────
void simulateDispense() {
  const VehicleType& v = pickVehicle();
  int volume = (random(v.minLitres / 5, (v.maxLitres / 5) + 1)) * 5;

  if (tankLevel - volume < 50.0f) {
    Serial.println(F("  ⚠ Buffer reached. Skipping dispense."));
    return;
  }

  Serial.printf("\n🚗 DISPENSE START | %s | %dL\n", v.name, volume);
  
  int chunks = volume / (int)DB_WRITE_CHUNK;
  for (int c = 1; c <= chunks; c++) {
    delay(DB_WRITE_INTERVAL_MS);
    elapsedSec += 5;
    tankLevel -= DB_WRITE_CHUNK;
    currentTemp = simulateTemp(elapsedSec);
    
    Serial.printf("   Progress: %d/%dL | Tank: %.1fL\n", c * 5, volume, tankLevel);
    pushToSupabase(tankLevel, currentTemp, currentRSSI);
  }
  dispenseCount++;
}

void simulateRefill() {
  float needed = TANK_CAPACITY - tankLevel;
  if (needed < 100) return;

  Serial.printf("\n⛽ REFILL START | Adding %.0fL\n", needed);

  int chunks = (int)(needed / REFILL_CHUNK);
  for (int c = 1; c <= chunks; c++) {
    delay(REFILL_INTERVAL_MS);
    elapsedSec += 2;
    tankLevel += REFILL_CHUNK;
    currentTemp = simulateTemp(elapsedSec);
    
    Serial.printf("   Refilling: +%.0fL | Tank: %.1fL\n", (float)c * REFILL_CHUNK, tankLevel);
    pushToSupabase(tankLevel, currentTemp, currentRSSI);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.printf("\nConnecting to %s ", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nCONNECTED!");

  randomSeed(esp_random());
  // Start with a level that triggers "Low Fuel Warning" (between 5% and 20%)
  tankLevel = round(randFloat(CRITICAL_THRESHOLD + 50, LOW_FUEL_THRESHOLD - 50) / 10.0f) * 10.0f;
  
  Serial.println(F("IoTank 4000L Simulator Online."));
  pushToSupabase(tankLevel, simulateTemp(0), currentRSSI);
}

void loop() {
  // 1. Refill Logic
  if (tankLevel <= CRITICAL_THRESHOLD) {
    simulateRefill();
  }

  // 2. High Frequency Anomaly Check (30% chance each cycle for testing)
  int dice = random(0, 100);
  if (dice < 10) {
    simulateTheft();
  } else if (dice < 20) {
    simulateHeatwave();
  } else if (dice < 30) {
    simulateConnectivityDrop();
  }

  // 3. Idle Heartbeat (Faster for testing: 30-60s)
  unsigned long idleSec = random(30, 60);
  Serial.printf("\n💤 Idle for %lu seconds...\n", idleSec);
  
  for (int i = 0; i < idleSec / 10; i++) {
    delay(10000); // 10s heartbeat
    elapsedSec += 10;
    currentTemp = simulateTemp(elapsedSec);
    currentRSSI = random(-70, -60); // Jitter RSSI
    pushToSupabase(tankLevel, currentTemp, currentRSSI);
  }

  // 4. Dispense Operation
  simulateDispense();
}
