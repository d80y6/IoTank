/*
  IoTank ESP32 Command & Control (C2) Snippet
  -------------------------------------------
  This snippet establishes a Realtime listener for the 'device_commands' table.
  Dependencies: Supabase-Arduino, ArduinoJson
*/

#include <Supabase.hpp>
#include <ArduinoJson.h>

// Your existing Supabase client should be initialized in setup()
// extern Supabase client; 

void handleIncomingCommand(String payload) {
    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
        Serial.print(F("C2: JSON Error - "));
        Serial.println(error.f_str());
        return;
    }

    String commandId = doc["record"]["id"].as<String>();
    String cmd = doc["record"]["command"].as<String>();
    JsonObject data = doc["record"]["payload"].as<JsonObject>();

    Serial.print("C2: Received Command [");
    Serial.print(cmd);
    Serial.println("]");

    bool success = false;
    String errorMsg = "";

    if (cmd == "PING") {
        Serial.println("C2: Diagnostic Handshake Successful.");
        success = true;
    } 
    else if (cmd == "SET_WIFI") {
        String ssid = data["ssid"].as<String>();
        String pass = data["password"].as<String>();
        Serial.printf("C2: Updating WiFi Credentials to SSID: %s\n", ssid.c_str());
        
        // Save to Preferences/LittleFS and reboot
        // saveWifiConfig(ssid, pass); 
        success = true;
    }
    else if (cmd == "REBOOT") {
        Serial.println("C2: Hardware Restart Initiated...");
        success = true;
        delay(1000);
        ESP.restart();
    }
    else {
        errorMsg = "Unknown command: " + cmd;
        Serial.println("C2: Error - " + errorMsg);
    }

    // Update command status back to Supabase
    updateCommandStatus(commandId, success ? "processed" : "failed", errorMsg);
}

void updateCommandStatus(String id, String status, String errorMsg) {
    StaticJsonDocument<256> doc;
    doc["status"] = status;
    if (errorMsg != "") doc["error_message"] = errorMsg;

    // processed_at is backfilled server-side by a DB trigger; do not send "now()".

    String json;
    serializeJson(doc, json);

    // Patch the record. This requires the device JWT (role=device) whose station_id
    // matches the command's station_id.
    SupabaseResult res = client.from("device_commands").update(json).eq("id", id).execute();
    if (!res.ok()) {
        Serial.printf("C2: Status patch failed (HTTP %d): %s\n", res.status_code, res.error_message.c_str());
        return;
    }
    Serial.printf("C2: Status Updated -> %s\n", status.c_str());
}

/* 
  Usage in loop():
  ----------------
  The Supabase Realtime client will automatically trigger the callback 
  when a new row is inserted into 'device_commands' matching this device_id.
*/
