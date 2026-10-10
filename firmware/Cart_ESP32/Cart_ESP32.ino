/*
 * SmartCart IoT - Full Cart Firmware (V4.2)
 * -----------------------------------------
 * QR code using ESP32 built-in QR library (esp_qrcode.h)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <ArduinoJson.h>
#include <qrcode.h>

// ============================
// WI-FI CREDENTIALS
// ============================
const char* ssid = "TECNO SPARK Go 2";
const char* password = "vddh30npbm211912";

// ============================
// API ENDPOINTS
// ============================
const char* SCAN_ENDPOINT = "https://smart-cart-5qod.vercel.app/api/hardware/scan-item";
const char* SYNC_ENDPOINT = "https://smart-cart-5qod.vercel.app/api/cart/sync";
const char* CART_ID = "CART_004";
const char* PAIR_BASE_URL = "https://smart-cart-5qod.vercel.app/app.html?cart_id=";

// ============================
// PIN CONFIGURATIONS
// ============================
#define RC522_SS   5
#define RC522_RST  4

#define TFT_CS   -1
#define TFT_RST  15
#define TFT_DC   12

#define BUZZER_PIN   25
#define RED_LED      26
#define GREEN_LED    27

// ============================
// OBJECTS
// ============================
SPIClass SPI_TFT(HSPI);
Adafruit_ST7789 tft = Adafruit_ST7789(&SPI_TFT, TFT_CS, TFT_DC, TFT_RST);
MFRC522 mfrc522(RC522_SS, RC522_RST);

// ============================
// STATE
// ============================
String lastScannedTag = "";
unsigned long lastScanTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 2000;
float cartTotal = 0.0;
int itemCount = 0;
bool cartActive = false;
unsigned long lastSyncTime = 0;
const unsigned long SYNC_INTERVAL_MS = 5000;
bool showingQRCode = false;

// ============================
// BUZZER EFFECTS
// ============================
void beepShort() { digitalWrite(BUZZER_PIN, HIGH); delay(100); digitalWrite(BUZZER_PIN, LOW); }
void beepDouble() {
  digitalWrite(BUZZER_PIN, HIGH); delay(80); digitalWrite(BUZZER_PIN, LOW);
  delay(60);
  digitalWrite(BUZZER_PIN, HIGH); delay(80); digitalWrite(BUZZER_PIN, LOW);
}
void beepTriple() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(BUZZER_PIN, HIGH); delay(70); digitalWrite(BUZZER_PIN, LOW); delay(50);
  }
}
void beepError() { digitalWrite(BUZZER_PIN, HIGH); delay(500); digitalWrite(BUZZER_PIN, LOW); }
void beepConnected() {
  digitalWrite(BUZZER_PIN, HIGH); delay(80); digitalWrite(BUZZER_PIN, LOW); delay(60);
  digitalWrite(BUZZER_PIN, HIGH); delay(120); digitalWrite(BUZZER_PIN, LOW); delay(60);
  digitalWrite(BUZZER_PIN, HIGH); delay(180); digitalWrite(BUZZER_PIN, LOW);
}
void beepRemoved() {
  digitalWrite(BUZZER_PIN, HIGH); delay(180); digitalWrite(BUZZER_PIN, LOW); delay(60);
  digitalWrite(BUZZER_PIN, HIGH); delay(80); digitalWrite(BUZZER_PIN, LOW);
}

// ============================
// LED HELPERS
// ============================
void flashGreen(int times) {
  for (int i = 0; i < times; i++) { digitalWrite(GREEN_LED, HIGH); delay(100); digitalWrite(GREEN_LED, LOW); delay(100); }
}
void flashRed(int times) {
  for (int i = 0; i < times; i++) { digitalWrite(RED_LED, HIGH); delay(100); digitalWrite(RED_LED, LOW); delay(100); }
}
void setGreen() { digitalWrite(GREEN_LED, HIGH); digitalWrite(RED_LED, LOW); }
void setRed() { digitalWrite(GREEN_LED, LOW); digitalWrite(RED_LED, HIGH); }

// ============================
// QR CODE DISPLAY CALLBACK
// ============================
void qr_display_callback(esp_qrcode_handle_t qrcode) {
  int size = esp_qrcode_get_size(qrcode);
  int moduleSize = 6;
  int qrSize = size * moduleSize;
  int xOffset = (240 - qrSize) / 2;
  int yOffset = 15;
  
  tft.fillScreen(ST77XX_WHITE);
  
  for (int y = 0; y < size; y++) {
    for (int x = 0; x < size; x++) {
      if (esp_qrcode_get_module(qrcode, x, y)) {
        tft.fillRect(xOffset + x * moduleSize,
                     yOffset + y * moduleSize,
                     moduleSize, moduleSize,
                     ST77XX_BLACK);
      }
    }
  }
}

void tftShowQRCode() {
  showingQRCode = true;
  String fullUrl = String(PAIR_BASE_URL) + String(CART_ID);

  esp_qrcode_config_t cfg = ESP_QRCODE_CONFIG_DEFAULT();
  cfg.display_func = qr_display_callback;
  cfg.max_qrcode_version = 10;
  cfg.qrcode_ecc_level = ESP_QRCODE_ECC_LOW;

  esp_qrcode_generate(&cfg, fullUrl.c_str());

  // Footer text
  tft.fillRect(0, 215, 240, 25, ST77XX_BLUE);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(1);
  tft.setCursor(15, 222);
  tft.println("Scan QR to pair this cart");
}

// ============================
// TFT DISPLAY
// ============================
void tftBootScreen() {
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(3);
  tft.setCursor(20, 60);
  tft.println("SmartCart");
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_GREEN);
  tft.setCursor(20, 110);
  tft.println("System Boot");
}

void tftShowStatus(String status, String subtext, uint16_t color) {
  showingQRCode = false;
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(color);
  tft.setTextSize(2);
  tft.setCursor(10, 40);
  tft.println(status);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(10, 90);
  tft.println(subtext);
}

void tftShowReady() {
  showingQRCode = false;
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_GREEN);
  tft.setTextSize(2);
  tft.setCursor(10, 20);
  tft.println("Ready");
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(10, 60);
  tft.println("Scan a tag");
  tft.setTextColor(ST77XX_CYAN);
  tft.setCursor(10, 120);
  tft.print("Items: "); tft.println(itemCount);
  tft.setCursor(10, 140);
  tft.print("Total: R"); tft.println(cartTotal, 2);
}

void tftShowScanned(String itemName, float price, String action) {
  showingQRCode = false;
  tft.fillScreen(ST77XX_BLACK);
  uint16_t titleColor = (action == "removed") ? ST77XX_RED : ST77XX_CYAN;
  String titleText = (action == "removed") ? "Removed" : "Added";
  tft.setTextColor(titleColor); tft.setTextSize(2);
  tft.setCursor(10, 20); tft.println(titleText);
  tft.setTextColor(ST77XX_WHITE); tft.setTextSize(2);
  tft.setCursor(10, 60); tft.println(itemName);
  tft.setTextSize(3); tft.setTextColor(ST77XX_YELLOW);
  tft.setCursor(10, 100); tft.print("R"); tft.println(price, 2);
  tft.setTextSize(1); tft.setTextColor(ST77XX_GREEN);
  tft.setCursor(10, 160);
  tft.print("Items: "); tft.print(itemCount);
  tft.print("  Total: R"); tft.println(cartTotal, 2);
}

void tftShowError(String error) {
  showingQRCode = false;
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_RED); tft.setTextSize(2);
  tft.setCursor(10, 50); tft.println("Error");
  tft.setTextSize(1); tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(10, 90); tft.println(error);
}

// ============================
// BOOT ANIMATION
// ============================
void bootAnimation() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(GREEN_LED, HIGH); digitalWrite(RED_LED, HIGH); delay(150);
    digitalWrite(GREEN_LED, LOW); digitalWrite(RED_LED, LOW); delay(150);
  }
  flashGreen(3); flashRed(3);
  beepTriple();
}

// ============================
// WiFi
// ============================
void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  tftShowStatus("Wi-Fi", "Connecting...", ST77XX_YELLOW);
  digitalWrite(RED_LED, LOW);
  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    digitalWrite(GREEN_LED, !digitalRead(GREEN_LED));
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi Connected!");
    setGreen(); beepConnected();
  } else {
    Serial.println("WiFi Failed.");
    tftShowError("WiFi failed"); setRed(); beepError();
  }
}

// ============================
// CART SYNC
// ============================
void syncCartState() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.begin(client, SYNC_ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  StaticJsonDocument<100> reqDoc;
  reqDoc["cart_id"] = CART_ID;
  String reqBody; serializeJson(reqDoc, reqBody);
  int httpResponseCode = http.POST(reqBody);
  if (httpResponseCode == 200) {
    String response = http.getString();
    StaticJsonDocument<2048> respDoc;
    DeserializationError error = deserializeJson(respDoc, response);
    if (!error && respDoc["success"]) {
      if (respDoc["session"].isNull()) {
        if (cartActive) {
          Serial.println("[Sync] Cart reset");
          cartActive = false; cartTotal = 0.0; itemCount = 0;
        }
        if (!showingQRCode) tftShowQRCode();
      } else {
        if (!cartActive) {
          Serial.println("[Sync] Cart active");
          cartActive = true; tftShowReady();
        }
        int totalCents = respDoc["session"]["totalCents"] | 0;
        cartTotal = totalCents / 100.0;
        JsonArray items = respDoc["session"]["items"];
        int totalQty = 0;
        for (JsonVariant item : items) totalQty += item["quantity"] | 0;
        itemCount = totalQty;
      }
    }
  }
  http.end();
}

// ============================
// SCAN API
// ============================
void sendItemScanToAPI(String rfidTag) {
  if (WiFi.status() != WL_CONNECTED) { connectToWiFi(); if (WiFi.status() != WL_CONNECTED) return; }
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.begin(client, SCAN_ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  StaticJsonDocument<200> doc;
  doc["cart_id"] = CART_ID; doc["rfid_tag"] = rfidTag; doc["action"] = "toggle";
  String requestBody; serializeJson(doc, requestBody);
  int httpResponseCode = http.POST(requestBody);
  if (httpResponseCode > 0) {
    String response = http.getString();
    if (httpResponseCode == 200) {
      StaticJsonDocument<4096> respDoc;
      DeserializationError error = deserializeJson(respDoc, response);
      if (!error && respDoc["success"]) {
        const char* productName = respDoc["session"]["lastAction"]["product"] | "Item";
        const char* action = respDoc["session"]["lastAction"]["action"] | "added";
        int totalCents = respDoc["session"]["totalCents"] | 0;
        cartTotal = totalCents / 100.0;
        JsonArray items = respDoc["session"]["items"];
        int totalQty = 0;
        for (JsonVariant item : items) totalQty += item["quantity"] | 0;
        itemCount = totalQty;
        cartActive = true;
        if (strcmp(action, "removed") == 0) { flashRed(2); beepRemoved(); }
        else { flashGreen(2); beepDouble(); }
        tftShowScanned(String(productName), cartTotal, String(action));
        delay(2000); tftShowReady(); setGreen();
      } else {
        tftShowError("Parse error"); delay(2000); tftShowReady();
      }
    } else {
      tftShowError("Server error"); delay(2000); tftShowReady();
    }
  } else {
    tftShowError("No connection"); delay(2000); tftShowReady();
  }
  http.end();
}

// ============================
// SETUP
// ============================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=== SmartCart V4.2 ===");

  pinMode(BUZZER_PIN, OUTPUT); pinMode(RED_LED, OUTPUT); pinMode(GREEN_LED, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW); digitalWrite(RED_LED, LOW); digitalWrite(GREEN_LED, LOW);

  SPI_TFT.begin(14, -1, 13, TFT_CS);
  tft.init(240, 240, SPI_MODE3);
  tft.setRotation(0);
  tftBootScreen();
  delay(1000);
  bootAnimation();

  SPI.begin(18, 19, 23, RC522_SS);
  mfrc522.PCD_Init();
  delay(500);
  byte version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print("RC522: 0x"); Serial.println(version, HEX);

  connectToWiFi();
  tftShowQRCode();
  Serial.println("Ready.");
}

// ============================
// LOOP
// ============================
void loop() {
  if (WiFi.status() != WL_CONNECTED) connectToWiFi();

  unsigned long now = millis();
  if (now - lastSyncTime > SYNC_INTERVAL_MS) {
    lastSyncTime = now;
    syncCartState();
  }

  if (!mfrc522.PICC_IsNewCardPresent()) { delay(50); return; }
  if (!mfrc522.PICC_ReadCardSerial()) { delay(50); return; }

  String currentTag = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    currentTag += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    currentTag += String(mfrc522.uid.uidByte[i], HEX);
  }
  currentTag.toUpperCase();

  if (currentTag != lastScannedTag || (now - lastScanTime) > DEBOUNCE_DELAY_MS) {
    Serial.print(">>> Tag: "); Serial.println(currentTag);
    lastScannedTag = currentTag; lastScanTime = now;
    tftShowStatus("Scanning", currentTag, ST77XX_CYAN);
    sendItemScanToAPI(currentTag);
  }
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  delay(500);
}