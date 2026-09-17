/*
 * The IoTank V2.0.0 - ESP32 Firmware Template (Supabase Edition)
 * 
 * Hardware: ESP32 + A02YYUW Ultrasonic Sensor + DS18B20 Temp Sensor
 * Libraries: 
 *   - HTTPClient (Built-in)
 *   - ArduinoJson (by Benoit Blanchon)
 *   - OneWire & DallasTemperature
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// --- WIFI CONFIGURATION ---
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// --- SUPABASE & DEVICE SECRETS ---
// Secrets should be provided via a local 'secrets.h' (ignored) to avoid committing keys.
#include "secrets.h"

// Fallback defaults (used only if 'secrets.h' is not present)
#ifndef SUPABASE_URL
#define SUPABASE_URL "https://your-project.supabase.co"
#endif

#ifndef SUPABASE_ANON_KEY
#define SUPABASE_ANON_KEY "YOUR_SUPABASE_ANON_KEY"
#endif

#ifndef DEVICE_JWT
#define DEVICE_JWT "YOUR_DEVICE_JWT_HERE"
#endif

// --- IDENTITY CONFIGURATION ---
// Provided via 'secrets.h'; falls back to placeholders.
#ifndef STATION_ID
#define STATION_ID "YOUR_STATION_UUID"
#endif

#ifndef TANK_ID
#define TANK_ID "YOUR_TANK_UUID"
#endif

// Tank type key into the platform's dip->volume calibration table
// (volume_lookup_tables.tank_type). Readable by the device role.
#ifndef TANK_TYPE
#define TANK_TYPE "diesel"
#endif

// Pin Definitions
#define SENSOR_TX 17 // Ultrasonic TX -> ESP32 RX2
#define SENSOR_RX 16 // Ultrasonic RX -> ESP32 TX2
#define ONE_WIRE_BUS 4 // DS18B20 Data Pin

// --- GLOBALS ---
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

unsigned char data[4] = {0};
float distance = 0;

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, SENSOR_TX, SENSOR_RX);
  sensors.begin();

  // WiFi Connection
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println("\nConnected to WiFi");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Pull the dip->volume strap table for this tank type (falls back to linear).
  fetchVolumeLookup();
}

float readUltrasonic() {
  if (Serial2.available() >= 4) { // Wait for full packet
    if (Serial2.read() == 0xff) {
      data[0] = 0xff;
      for (int i = 1; i < 4; i++) {
        data[i] = Serial2.read();
      }
      int sum = (data[0] + data[1] + data[2]) & 0x00FF;
      if (sum == data[3]) {
        distance = (data[1] << 8) + data[2];
        return distance / 10.0; // Return in cm
      }
    }
  }
  return -1;
}

// Logic to convert distance to volume should happen here or on ESP32
// Strap table is fetched from Supabase (volume_lookup_tables) at boot; if it is
// unavailable we fall back to a simple linear approximation.
#define LOOKUP_MAX_POINTS 64
struct VolumePoint { int dipMm; float volumeL; };
VolumePoint volumeTable[LOOKUP_MAX_POINTS];
int volumeTableCount = 0;

bool fetchVolumeLookup() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(SUPABASE_URL) +
    "/rest/v1/volume_lookup_tables?select=dip_mm,volume_liters&tank_type=eq." +
    String(TANK_TYPE) + "&order=dip_mm.asc";

  http.begin(url);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", "Bearer " + String(DEVICE_JWT));
  http.addHeader("Accept", "application/json");

  int code = http.GET();
  if (code != 200) {
    Serial.printf("Calibration fetch failed (HTTP %d)\n", code);
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();

  DynamicJsonDocument doc(8192);
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.printf("Calibration parse failed: %s\n", err.c_str());
    return false;
  }

  volumeTableCount = 0;
  for (JsonObject row : doc.as<JsonArray>()) {
    if (volumeTableCount >= LOOKUP_MAX_POINTS) break;
    volumeTable[volumeTableCount].dipMm = row["dip_mm"].as<int>();
    volumeTable[volumeTableCount].volumeL = row["volume_liters"].as<float>();
    volumeTableCount++;
  }
  Serial.printf("Loaded %d calibration points for tank_type=%s\n", volumeTableCount, TANK_TYPE);
  return volumeTableCount > 0;
}

float calculateVolume(float distCm) {
    // Interpolate against the downloaded strap table when available.
    if (volumeTableCount >= 2) {
      float mm = distCm * 10.0;
      if (mm <= volumeTable[0].dipMm) return volumeTable[0].volumeL;
      for (int i = 1; i < volumeTableCount; i++) {
        if (mm <= volumeTable[i].dipMm) {
          float span = volumeTable[i].dipMm - volumeTable[i - 1].dipMm;
          if (span <= 0) return volumeTable[i].volumeL;
          float ratio = (mm - volumeTable[i - 1].dipMm) / span;
          return volumeTable[i - 1].volumeL + ratio * (volumeTable[i].volumeL - volumeTable[i - 1].volumeL);
        }
      }
      return volumeTable[volumeTableCount - 1].volumeL;
    }
    // Fallback: linear tank where 1cm = 10 Litres
    return distCm * 10.0;
}

void sendTelemetry(float volume, float tempC) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi Disconnected. Skipping send.");
    return;
  }

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/sensor_readings";
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", "Bearer " + String(DEVICE_JWT));
  http.addHeader("Prefer", "return=minimal");

  // Create JSON payload (matches the partitioned sensor_readings schema)
  StaticJsonDocument<256> doc;
  doc["tank_id"] = TANK_ID;
  doc["station_id"] = STATION_ID;
  doc["volume"] = volume; // Direct volume as requested
  doc["temperature"] = tempC;
  doc["water_level"] = distance; // Raw distance in cm
  doc.createNestedObject("metadata")["rssi"] = WiFi.RSSI();

  String payload;
  serializeJson(doc, payload);


  Serial.print("Sending payload: ");
  Serial.println(payload);

  int httpResponseCode = http.POST(payload);

  if (httpResponseCode > 0) {
    Serial.print("HTTP Response code: ");
    Serial.println(httpResponseCode);
    if (httpResponseCode == 201) {
      Serial.println("Data synced to Supabase successfully.");
    }
  } else {
    Serial.print("Error code: ");
    Serial.println(httpResponseCode);
  }

  http.end();
}

void loop() {
  sensors.requestTemperatures();
  float tempC = sensors.getTempCByIndex(0);
  float distCm = readUltrasonic();

  if (distCm > 0) {
    float volume = calculateVolume(distCm);
    sendTelemetry(volume, tempC);
  } else {
    Serial.println("Failed to read ultrasonic sensor.");
  }


  // Heartbeat / Delay
  // In production, consider ESP.deepSleep() for battery savings.
  delay(60000); 
}
