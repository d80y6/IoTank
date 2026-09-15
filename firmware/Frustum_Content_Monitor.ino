#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ─── WiFi Configuration ──────────────────────────────────────
const char* WIFI_SSID     = "ESP32";
const char* WIFI_PASSWORD = "Joseph26";

// ─── Supabase Configuration ─────────────────────────────────
const char* SUPABASE_URL              = "https://suifvborodwergtrbjez.supabase.co/rest/v1/sensor_readings";
const char* SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1aWZ2Ym9yb2R3ZXJndHJiamV6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc2MDc0MCwiZXhwIjoyMDg5MzM2NzQwfQ.96AE-5FQpBvOKKjfNmbqWX05x3ND6ifyO4ITP0c-Gvc";

// ─── ID Configuration ───────────────────────────────────────
// These will be updated by the user from the Super Admin Portal
const char* STATION_ID = "9a594b8e-15b2-48a8-b17d-7ef7fa5e9b8a"; 
const char* TANK_ID    = "613195dd-00a7-48f3-bc46-f66030393106";

// Hardware JWT placeholder
const char* SECURE_DEVICE_TOKEN = "PASTE_YOUR_HARDWARE_JWT_HERE"; 

// ─── Hardware Pins ──────────────────────────────────────────
const int trigPin = 12;
const int echoPin = 13;
#define SENSOR_PIN 4

// ─── Timing Constants ───────────────────────────────────────
#define SYSTEM_TICK_MS 5000 // Push to Supabase every 5 seconds

// ─── Sensor Setup ───────────────────────────────────────────
OneWire oneWire(SENSOR_PIN);
DallasTemperature sensors(&oneWire);
int deviceCount = 0;
unsigned long lastExecutionTime = 0;
int currentRSSI = 0;

// ─── Tank Geometry Constants (all dimensions in cm) ─────────
const float TOTAL_HEIGHT = 13.5;
const float R1 = 4.25; // Large bottom radius
const float R2 = 2.95; // Small top radius
const float PI_VAL = 3.14159265;

// ─── Supabase Push Function ─────────────────────────────────
void pushToSupabase(float volLiters, float temp, int rssi) {
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

  // Payload matches the simplified sensor_readings schema (volume, temperature, rssi)
  String jsonPayload = "{\"station_id\": \"" + String(STATION_ID) + 
                       "\", \"tank_id\": \"" + String(TANK_ID) + 
                       "\", \"volume\": " + String(volLiters, 4) + 
                       ", \"temperature\": " + String(temp, 2) + 
                       ", \"rssi\": " + String(rssi) + "}";

  int httpResponseCode = http.POST(jsonPayload);

  if (httpResponseCode >= 200 && httpResponseCode <= 299) {
    Serial.printf("  [Supabase] Push Success: %.4f L | %.2f °C | %d dBm\n", volLiters, temp, rssi);
  } else {
    Serial.printf("  [Supabase] Error: (HTTP %d) %s\n", httpResponseCode, http.getString().c_str());
  }
  
  http.end();
}

void scanBus() {
  sensors.begin();
  deviceCount = sensors.getDeviceCount();
  Serial.print("Devices found on bus: ");
  Serial.println(deviceCount);
}

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10); // Wait for USB CDC to connect
  
  Serial.println("=== Frustum Content Monitor (Live to Supabase) ===");
  
  // Initialize Ultrasonic Pins
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  digitalWrite(trigPin, LOW);
  
  // Initialize Temperature Sensor
  scanBus();
  if (deviceCount == 0) {
    Serial.println("ERROR: No DS18B20 sensor detected.");
  }
  
  // Connect to WiFi
  Serial.printf("\nConnecting to %s ", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nCONNECTED!");
  
  delay(1000);
}

void loop() {
  unsigned long currentMillis = millis();

  // Execute entire cycle strictly every SYSTEM_TICK_MS (5 seconds)
  if (currentMillis - lastExecutionTime >= SYSTEM_TICK_MS) {
    lastExecutionTime = currentMillis;

    float currentVolume = 0.0;
    float currentTemp = 0.0;
    currentRSSI = WiFi.RSSI();

    // =================================================================
    // 1. MEASURE DISTANCE & CALCULATE CORRECTED VOLUME (in mL / cm3)
    // =================================================================
    digitalWrite(trigPin, LOW);
    delayMicroseconds(5);
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(15);
    digitalWrite(trigPin, LOW);

    long duration = pulseIn(echoPin, HIGH, 30000);
    
    if (duration == 0) {
      Serial.println("Distance Error: Out of range or no sensor found");
    } else {
      float distance = duration * 0.034 / 2;
      
      // Top-down sensor orientation
      float contentHeight = TOTAL_HEIGHT - distance;

      if (contentHeight < 0.0) {
        Serial.println("Check your system-error");
        currentVolume = 0.0;
      } else {
        if (distance < 0.0) {
          Serial.println("Check your system-error");
          contentHeight = TOTAL_HEIGHT; 
        }

        // Linear interpolation: filled from bottom (R1) up to top (R2)
        float rFluid = R1 - ((R1 - R2) / TOTAL_HEIGHT) * contentHeight;

        // Conical frustum volume formula for the fluid contents
        currentVolume = (1.0 / 3.0) * PI_VAL * contentHeight * ((R1 * R1) + (R1 * rFluid) + (rFluid * rFluid));

        Serial.print("Height: ");
        Serial.print(contentHeight, 2);
        Serial.print(" cm | Volume: ");
        Serial.print(currentVolume, 2);
        Serial.println(" mL");
      }
    }

    // =================================================================
    // 2. MEASURE TEMPERATURE
    // =================================================================
    if (deviceCount == 0) {
      Serial.println("No temperature sensor. Rescanning...");
      scanBus();
    } else {
      sensors.requestTemperatures();
      currentTemp = sensors.getTempCByIndex(0);
      
      if (currentTemp == DEVICE_DISCONNECTED_C || currentTemp == -127.0) {
        Serial.println("ERROR: Temperature sensor disconnected. Rescanning...");
        scanBus();
        currentTemp = 0.0;
      } else {
        float tempF = sensors.toFahrenheit(currentTemp);
        Serial.print("Temperature: ");
        Serial.print(currentTemp, 2);
        Serial.print(" °C / ");
        Serial.print(tempF, 2);
        Serial.println(" °F");
      }
    }
    
    // =================================================================
    // 3. PUSH TO SUPABASE (Convert mL to Liters first)
    // =================================================================
    // Only push if we got a valid reading
    if (currentVolume >= 0.0) {
        // IoTank database expects volumes to be stored in Liters (L)
        // 1 Liter = 1000 mL (cm³)
        float currentVolumeLiters = currentVolume / 1000.0;
        pushToSupabase(currentVolumeLiters, currentTemp, currentRSSI);
    }
    
    Serial.println("----------------------------------");
  }
}
