/*
 * ============================================================
 *  SmartCart IoT - Base Station ESP32 Firmware  (v3)
 * ============================================================
 *  - Continuously monitors the cart's station tag (no halt)
 *  - Tag present → POST station-dock (once)
 *  - Tag absent for 5s → POST station-undock
 *  - LEDs show state
 * ============================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

const char* ssid = "TECNO SPARK Go 2";
const char* password = "vddh30npbm211912";

const char* DOCK_ENDPOINT   = "https://smart-cart-5qod.vercel.app/api/hardware/station-dock";
const char* UNDOCK_ENDPOINT = "https://smart-cart-5qod.vercel.app/api/hardware/station-undock";
const char* STATION_ID      = "STATION_BASE_01";
const char* PHYSICAL_TAG    = "27E5F505";
const char* CART_ID         = "cart_004";

#define SS_PIN       5
#define RST_PIN      22
#define GREEN_LED    26
#define RED_LED      27

MFRC522 mfrc522(SS_PIN, RST_PIN);

bool cartIsHere = false;
unsigned long lastSeenAt = 0;
const unsigned long UNDOCK_TIMEOUT_MS = 5000;
const unsigned long POLL_INTERVAL_MS  = 300;

void setGreen() { digitalWrite(GREEN_LED, HIGH); digitalWrite(RED_LED, LOW); }
void setRed()   { digitalWrite(GREEN_LED, LOW);  digitalWrite(RED_LED, HIGH); }

void flashGreen(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(GREEN_LED, HIGH); delay(150);
    digitalWrite(GREEN_LED, LOW);  delay(150);
  }
}

void flashRed(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(RED_LED, HIGH); delay(150);
    digitalWrite(RED_LED, LOW);  delay(150);
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
    setRed();
  } else {
    Serial.println("\nWi-Fi Connection Failed.");
    setRed();
  }
}

int postEvent(const char* endpoint, const char* label) {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
    if (WiFi.status() != WL_CONNECTED) return -1;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, endpoint);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);

  StaticJsonDocument<200> doc;
  doc["station_id"] = STATION_ID;
  doc["cart_rfid_tag"] = CART_ID;

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.print("[HTTP] Sending ");
  Serial.print(label);
  Serial.println(" event...");
  Serial.println(requestBody);

  int code = http.POST(requestBody);
  if (code > 0) {
    String response = http.getString();
    Serial.print("[HTTP] Code: ");
    Serial.println(code);
    Serial.print("[HTTP] Response: ");
    Serial.println(response);
  } else {
    Serial.print("[HTTP] Error Code: ");
    Serial.println(code);
  }
  http.end();
  return code;
}

// ============================================================
//  TAG READER
//  Returns true if the physical cart tag is present.
//  Does NOT halt the PICC, so the reader keeps seeing the tag.
// ============================================================
bool isCartTagPresent() {
  byte bufferATQA[2];
  byte bufferSize = sizeof(bufferATQA);

  MFRC522::StatusCode status = mfrc522.PICC_RequestA(bufferATQA, &bufferSize);
  if (status != MFRC522::STATUS_OK) return false;

  if (!mfrc522.PICC_ReadCardSerial()) return false;

  String tag = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    tag += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    tag += String(mfrc522.uid.uidByte[i], HEX);
  }
  tag.toUpperCase();

  return (tag == PHYSICAL_TAG);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=== SmartCart STATION v3 ===");

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);

  flashGreen(3);
  flashRed(3);

  SPI.begin();
  mfrc522.PCD_Init();
  Serial.println("MFRC522 RFID Reader Initialized.");

  connectToWiFi();
  lastSeenAt = millis();

  Serial.println("Station Ready. Waiting for cart...");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectToWiFi();

  unsigned long now = millis();

  bool tagPresent = isCartTagPresent();

  if (tagPresent) {
    lastSeenAt = now;
    if (!cartIsHere) {
      Serial.println(">>> Cart tag detected. Docking...");
      int code = postEvent(DOCK_ENDPOINT, "dock");
      if (code == 200) {
        cartIsHere = true;
        flashGreen(5);
        setGreen();
      } else {
        flashRed(3);
        setRed();
      }
    }
  } else {
    if (cartIsHere && (now - lastSeenAt > UNDOCK_TIMEOUT_MS)) {
      Serial.println(">>> Cart tag lost. Undocking...");
      int code = postEvent(UNDOCK_ENDPOINT, "undock");
      cartIsHere = false;
      if (code == 200) {
        flashRed(5);
      } else {
        flashRed(3);
      }
      setRed();
    }
  }

  // NOTE: no halt, no StopCrypto1 — we want to keep reading the tag
  delay(POLL_INTERVAL_MS);
}