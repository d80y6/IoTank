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
#define SUPABASE_URL "https://suifvborodwergtrbjez.supabase.co"
#endif

#ifndef SUPABASE_ANON_KEY
#define SUPABASE_ANON_KEY "YOUR_SUPABASE_ANON_KEY"
#endif

#ifndef DEVICE_JWT
#define DEVICE_JWT "YOUR_DEVICE_JWT_HERE"
#endif

// --- IDENTITY CONFIGURATION ---
#define STATION_ID "YOUR_STATION_UUID"
#define TANK_ID "YOUR_TANK_UUID"

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
// For this template, we assume the user has a calibration function
float calculateVolume(float distCm) {
    // Placeholder: Implement your tank strapping table logic here
    // Example: Linear tank where 1cm = 10 Litres
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

  // Create JSON payload
  StaticJsonDocument<256> doc;
  doc["tank_id"] = TANK_ID;
  doc["station_id"] = STATION_ID;
  doc["volume"] = volume; // Direct volume as requested
  doc["temperature"] = tempC;
  doc["rssi"] = WiFi.RSSI();

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
