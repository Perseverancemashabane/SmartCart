/*
 * SmartCart IoT - Physical Cart ESP32 Firmware
 * --------------------------------------------
 * Hardware:
 *   - ESP32 Development Board
 *   - MFRC522 RFID Reader (SPI Interface)
 *   - Optional Buzzer / LED for Audio/Visual Scan Feedback
 *
 * Functionality:
 *   1. Scans RFID tags attached to items dropped into the cart.
 *   2. POSTs scan events to Next.js API (/api/hardware/scan-item).
 *   3. Handles auto Wi-Fi reconnection, debouncing, and status reporting.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

// Wi-Fi Credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Next.js API Endpoint URL
const char* API_ENDPOINT  = "http://192.168.1.100:3000/api/hardware/scan-item";

// Cart Identifier
const char* CART_ID       = "CART_004";

// Pin Configurations for MFRC522 RFID Reader
#define SS_PIN    5
#define RST_PIN   22
#define BUZZER_PIN 4

MFRC522 mfrc522(SS_PIN, RST_PIN);

// Debouncing variables
String lastScannedTag = "";
unsigned long lastScanTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 2000; // 2 second delay between duplicate tag scans

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWi-Fi Connection Failed. Retrying in loop...");
  }
}

void triggerBuzzer() {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);
}

void sendItemScanToAPI(String rfidTag, String action) {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  HTTPClient http;
  http.begin(API_ENDPOINT);
  http.addHeader("Content-Type", "application/json");

  // Construct JSON Payload
  StaticJsonDocument<200> doc;
  doc["cart_id"] = CART_ID;
  doc["rfid_tag"] = rfidTag;
  doc["action"] = action;

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.println("[HTTP] Sending RFID payload to Next.js API...");
  Serial.println(requestBody);

  int httpResponseCode = http.POST(requestBody);

  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.print("[HTTP] Code: ");
    Serial.println(httpResponseCode);
    Serial.print("[HTTP] Response: ");
    Serial.println(response);
    
    if (httpResponseCode == 200) {
      triggerBuzzer(); // Beep on successful scan
    }
  } else {
    Serial.print("[HTTP] Error Code: ");
    Serial.println(httpResponseCode);
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  SPI.begin();
  mfrc522.PCD_Init();
  Serial.println("MFRC522 RFID Reader Initialized.");

  connectToWiFi();
}

void loop() {
  // Ensure Wi-Fi connection is maintained
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  // Look for new RFID card/tag present
  if (!mfrc522.PICC_IsNewCardPresent()) {
    delay(50);
    return;
  }

  // Read RFID serial UID
  if (!mfrc522.PICC_ReadCardSerial()) {
    delay(50);
    return;
  }

  // Convert UID bytes to Hex String
  String currentTag = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    currentTag += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    currentTag += String(mfrc522.uid.uidByte[i], HEX);
  }
  currentTag.toUpperCase();

  unsigned long now = millis();

  // Debouncing logic
  if (currentTag != lastScannedTag || (now - lastScanTime) > DEBOUNCE_DELAY_MS) {
    Serial.print("RFID Tag Scanned: ");
    Serial.println(currentTag);

    lastScannedTag = currentTag;
    lastScanTime = now;

    // Send "add" action to Next.js API
    sendItemScanToAPI(currentTag, "add");
  }

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
}
