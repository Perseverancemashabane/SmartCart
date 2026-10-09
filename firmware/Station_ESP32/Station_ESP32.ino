/*
 * SmartCart IoT - Base Station ESP32 Firmware
 * -------------------------------------------
 * Hardware:
 *   - ESP32 Development Board (separate from the cart)
 *   - MFRC522 RFID Reader (SPI Interface)
 *   - Green LED (Ready/Docked)
 *   - Red LED (Error/Roaming)
 *   - No buzzer
 *
 * Functionality:
 *   1. Continuously scans for the cart's station tag.
 *   2. When detected, POSTs to /api/hardware/station-dock.
 *   3. Visual feedback via LEDs.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

// ============================
// WI-FI CREDENTIALS
// ============================
const char* ssid = "TECNO SPARK Go 2";
const char* password = "vddh30npbm211912";

// ============================
// API ENDPOINT
// ============================
const char* API_ENDPOINT = "https://smart-cart-5qod.vercel.app/api/hardware/station-dock";
const char* STATION_ID = "STATION_BASE_01";
const char* PHYSICAL_TAG = "27E5F505";   // The physical tag on the cart handle
const char* CART_ID = "CART_004";        // The cart's database ID

// ============================
// PIN CONFIGURATIONS
// ============================
#define SS_PIN       5
#define RST_PIN      22
#define GREEN_LED    26
#define RED_LED      27

MFRC522 mfrc522(SS_PIN, RST_PIN);

// ============================
// STATE
// ============================
String lastScannedTag = "";
unsigned long lastScanTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 5000; // 5 seconds between dock events

// ============================
// HELPER FUNCTIONS
// ============================

void setGreen() {
  digitalWrite(GREEN_LED, HIGH);
  digitalWrite(RED_LED, LOW);
}

void setRed() {
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, HIGH);
}

void flashGreen(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(GREEN_LED, HIGH);
    delay(150);
    digitalWrite(GREEN_LED, LOW);
    delay(150);
  }
}

void flashRed(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(RED_LED, HIGH);
    delay(150);
    digitalWrite(RED_LED, LOW);
    delay(150);
  }
}

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(ssid);

  digitalWrite(RED_LED, LOW);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    digitalWrite(GREEN_LED, !digitalRead(GREEN_LED));
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    setGreen();
  } else {
    Serial.println("\nWi-Fi Connection Failed.");
    setRed();
  }
}

void sendDockEvent() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, API_ENDPOINT);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<200> doc;
  doc["station_id"] = STATION_ID;
  doc["cart_rfid_tag"] = CART_ID;

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.println("[HTTP] Sending dock event...");
  Serial.println(requestBody);

  int httpResponseCode = http.POST(requestBody);

  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.print("[HTTP] Code: ");
    Serial.println(httpResponseCode);
    Serial.print("[HTTP] Response: ");
    Serial.println(response);

    if (httpResponseCode == 200) {
      flashGreen(5);
      setGreen();
    } else {
      flashRed(3);
      setGreen();
    }
  } else {
    Serial.print("[HTTP] Error Code: ");
    Serial.println(httpResponseCode);
    flashRed(5);
    setGreen();
  }

  http.end();
}

// ============================
// SETUP
// ============================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n\n=== SmartCart STATION ===");

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);

  // Boot flash
  flashGreen(3);
  flashRed(3);

  // Init RFID
  SPI.begin();
  mfrc522.PCD_Init();
  Serial.println("MFRC522 RFID Reader Initialized.");

  // Connect WiFi
  connectToWiFi();

  Serial.println("Station Ready. Waiting for cart...");
}

// ============================
// LOOP
// ============================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  if (!mfrc522.PICC_IsNewCardPresent()) {
    delay(50);
    return;
  }

  if (!mfrc522.PICC_ReadCardSerial()) {
    delay(50);
    return;
  }

  String currentTag = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    currentTag += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    currentTag += String(mfrc522.uid.uidByte[i], HEX);
  }
  currentTag.toUpperCase();

  Serial.print(">>> Tag detected: ");
  Serial.println(currentTag);

  unsigned long now = millis();

  // Only respond to the cart's station tag
  if (currentTag == PHYSICAL_TAG && (currentTag != lastScannedTag || (now - lastScanTime) > DEBOUNCE_DELAY_MS)) {
    Serial.println("Cart detected! Sending dock event...");
    lastScannedTag = currentTag;
    lastScanTime = now;

    sendDockEvent();
  } else if (currentTag != PHYSICAL_TAG) {
    Serial.println("Unknown tag — ignoring.");
  }

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();

  delay(1500);
}