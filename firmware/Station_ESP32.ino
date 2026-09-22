/*
 * SmartCart IoT - Base Station ESP32 Firmware
 * -------------------------------------------
 * Hardware:
 *   - ESP32 Development Board
 *   - MFRC522 RFID Reader / IR Proximity Sensor installed at Checkout Docking Bay
 *   - Green & Red Status LEDs
 *
 * Functionality:
 *   1. Detects cart RFID tag when a cart docks at the checkout station.
 *   2. POSTs station docking event to Next.js API (/api/hardware/station-dock).
 *   3. Unlocks customer payment on the web frontend in real-time.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

// Wi-Fi Credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Base Station Identifiers
const char* STATION_ID    = "STATION_BASE_01";
const char* API_ENDPOINT  = "http://192.168.1.100:3000/api/hardware/station-dock";

// Pin Configurations
#define SS_PIN       5
#define RST_PIN      22
#define LED_GREEN    12
#define LED_RED      14

MFRC522 mfrc522(SS_PIN, RST_PIN);

String lastDockedTag = "";
unsigned long lastDockTime = 0;
const unsigned long DOCK_COOLDOWN_MS = 5000; // 5s cooldown between station dock signals

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Base Station Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    digitalWrite(LED_RED, !digitalRead(LED_RED));
    delay(500);
    Serial.print(".");
  }

  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, HIGH);
  Serial.println("\nBase Station Wi-Fi Connected!");
}

void sendStationDockToAPI(String cartRfidTag) {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  HTTPClient http;
  http.begin(API_ENDPOINT);
  http.addHeader("Content-Type", "application/json");

  // Construct JSON Payload
  StaticJsonDocument<200> doc;
  doc["station_id"] = STATION_ID;
  doc["cart_rfid_tag"] = cartRfidTag;

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.println("[HTTP] Sending Station Dock event to Next.js API...");
  Serial.println(requestBody);

  int httpResponseCode = http.POST(requestBody);

  if (httpResponseCode == 200) {
    Serial.println("[Station] Cart Docking Confirmed & Unlocked for Payment!");
    // Blink Green LED rapidly to signify docking lock
    for (int i = 0; i < 4; i++) {
      digitalWrite(LED_GREEN, LOW);
      delay(100);
      digitalWrite(LED_GREEN, HIGH);
      delay(100);
    }
  } else {
    Serial.print("[HTTP] Station Dock Error Code: ");
    Serial.println(httpResponseCode);
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);

  digitalWrite(LED_GREEN, LOW);
  digitalWrite(LED_RED, HIGH);

  SPI.begin();
  mfrc522.PCD_Init();
  Serial.println("Base Station RFID Reader Active.");

  connectToWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  // Look for cart RFID tag docking at station
  if (!mfrc522.PICC_IsNewCardPresent()) {
    delay(50);
    return;
  }

  if (!mfrc522.PICC_ReadCardSerial()) {
    delay(50);
    return;
  }

  String cartTag = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    cartTag += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    cartTag += String(mfrc522.uid.uidByte[i], HEX);
  }
  cartTag.toUpperCase();

  unsigned long now = millis();

  if (cartTag != lastDockedTag || (now - lastDockTime) > DOCK_COOLDOWN_MS) {
    Serial.print("Cart Tag Docked at Station: ");
    Serial.println(cartTag);

    lastDockedTag = cartTag;
    lastDockTime = now;

    sendStationDockToAPI(cartTag);
  }

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
}
