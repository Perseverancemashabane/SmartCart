/*
 * ============================================================
 *  SmartCart — ESP32 Cart Firmware  (v4 — with QR via ESP-IDF)
 * ============================================================
 *  Cart ID: cart_004
 *  Backend: https://smart-cart-5qod.vercel.app
 * ============================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Keypad.h>
#include <qrcode.h>

// ============================================================
//  CONFIGURATION
// ============================================================
const char* WIFI_SSID     = "TECNO SPARK Go 2";
const char* WIFI_PASSWORD = "vddh30npbm211912";

const char* BACKEND_URL   = "https://smart-cart-5qod.vercel.app";
const char* CART_ID       = "cart_004";
const char* COOKIE_NAME   = "smartcart_session";
const char* PAIR_BASE_URL = "https://smart-cart-5qod.vercel.app/app.html?cart_id=";

// Extra colors
#define ST77XX_NAVY   0x000F
#define ST77XX_DARK   0x0841
#define ST77XX_ACCENT 0x05BF
#define ST77XX_MUTED  0x8410

// ============================================================
//  PIN DEFINITIONS
// ============================================================
#define TFT_CS    -1
#define TFT_RST   15
#define TFT_DC    12
#define TFT_SCK   14
#define TFT_MOSI  13

#define RC522_SS   5
#define RC522_RST  4
#define RC522_SCK  18
#define RC522_MISO 19
#define RC522_MOSI 23

#define BUZZER_PIN 25
#define RED_LED    26

const byte ROWS = 4;
const byte COLS = 3;
char keys[ROWS][COLS] = {
  {'2','1','3'},
  {'0','*','#'},
  {'8','7','9'},
  {'5','4','6'}
};
byte rowPins[ROWS] = {32, 33, 21, 22};
byte colPins[COLS] = {16, 17, 27};

// ============================================================
//  OBJECTS
// ============================================================
SPIClass SPI_TFT(HSPI);
Adafruit_ST7789 tft = Adafruit_ST7789(&SPI_TFT, TFT_CS, TFT_DC, TFT_RST);
MFRC522 rfid(RC522_SS, RC522_RST);
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ============================================================
//  STATE MACHINE
// ============================================================
enum CartState {
  ST_IDLE,
  ST_PHONE_ENTRY,
  ST_LOOKING_UP,
  ST_NOT_REGISTERED,
  ST_WELCOME,
  ST_MODE_MENU,
  ST_WEBSITE_QR,
  ST_MANUAL_PIN,
  ST_SCAN_MODE,
  ST_CONFIRM_CANCEL,
  ST_CART_CLEARED,
  ST_DOCKED_PAYMENT,
  ST_MANUAL_PAY_PIN,
  ST_PAYMENT_DONE
};

CartState currentState = ST_IDLE;
String typed = "";
String phoneNumber = "";
String customerName = "";
String customerId = "";
String authToken = "";
String lastUID = "";
String errorMessage = "";
unsigned long lastUIDAt = 0;
unsigned long errorShownAt = 0;
unsigned long stateEnteredAt = 0;
unsigned long lastPollAt = 0;

long subtotalCents = 0;
long taxCents = 0;
long totalCents = 0;
bool cartIsDocked = false;
String sessionItems = "";

// ============================================================
//  FORWARD DECLARATIONS
// ============================================================
void tftTextRight(const char* text, int16_t xRight, int16_t y,
                  uint16_t color = ST77XX_WHITE, uint8_t size = 2);

// ============================================================
//  BEEP
// ============================================================
void beep(int ms = 70) { tone(BUZZER_PIN, 2200, ms); }
void beepError() { tone(BUZZER_PIN, 500, 300); }
void beepSuccess() {
  tone(BUZZER_PIN, 2500, 60);
  delay(70);
  tone(BUZZER_PIN, 3200, 70);
}

// ============================================================
//  TFT HELPERS
// ============================================================
void tftClear() { tft.fillScreen(ST77XX_BLACK); }

void tftHeader(const char* title, const char* subtitle = nullptr) {
  tft.fillRect(0, 0, 240, 44, ST77XX_NAVY);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(12, 10);
  tft.print(title);
  if (subtitle && strlen(subtitle) > 0) {
    tft.setTextColor(ST77XX_ACCENT);
    tft.setTextSize(1);
    tft.setCursor(12, 32);
    tft.print(subtitle);
  }
}

void tftCenter(int y, const char* text, uint16_t color = ST77XX_WHITE, uint8_t size = 2) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.setTextColor(color);
  tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  tft.setCursor((240 - w) / 2, y);
  tft.print(text);
}

void tftLine(int y, const char* text, uint16_t color = ST77XX_WHITE, uint8_t size = 2) {
  tft.setTextColor(color);
  tft.setTextSize(size);
  tft.setCursor(12, y);
  tft.print(text);
}

void tftTextRight(const char* text, int16_t xRight, int16_t y,
                  uint16_t color, uint8_t size) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.setTextColor(color);
  tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  tft.setCursor(xRight - w, y);
  tft.print(text);
}

void tftHint(const char* hint) {
  tft.fillRect(0, 218, 240, 22, ST77XX_DARK);
  tft.setTextColor(ST77XX_MUTED);
  tft.setTextSize(1);
  tft.setCursor(8, 225);
  tft.print(hint);
}

void tftError(const char* msg) {
  tft.fillRect(0, 178, 240, 34, ST77XX_RED);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(1);
  tft.setCursor(8, 186);
  tft.print(msg);
}

// ============================================================
//  FORMAT CENTS
// ============================================================
String rands(long cents) {
  char buf[24];
  snprintf(buf, sizeof(buf), "R%ld.%02ld", cents / 100, cents % 100);
  return String(buf);
}

// ============================================================
//  HTTP HELPERS
// ============================================================
String httpPost(const String& path, const String& jsonBody, bool useCookie = false) {
  if (WiFi.status() != WL_CONNECTED) return "";

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, String(BACKEND_URL) + path);
  http.addHeader("Content-Type", "application/json");

  if (useCookie && authToken.length() > 0) {
    String ck = String(COOKIE_NAME) + "=" + authToken;
    http.addHeader("Cookie", ck);
  }

  http.setTimeout(3000);
  int code = http.POST(jsonBody);
  String response = http.getString();
  http.end();

  Serial.printf("[HTTP] POST %s -> %d\n", path.c_str(), code);
  Serial.println(response);
  return response;
}

// ============================================================
//  LOOKUP CUSTOMER
// ============================================================
bool lookupCustomer(const String& phone, String& outName, String& outId) {
  String body = "{\"phone_number\":\"" + phone + "\"}";
  String resp = httpPost("/api/customers/lookup", body);
  if (resp.length() == 0) return false;

  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, resp)) return false;

  bool found = doc["found"] | false;
  if (!found) return false;

  outName = doc["customer"]["name"].as<String>();
  outId   = doc["customer"]["id"].as<String>();
  return true;
}

// ============================================================
//  LOGIN
// ============================================================
bool login(const String& phone, const String& pin) {
  String body = "{\"phone_number\":\"" + phone + "\",\"pin\":\"" + pin + "\"}";
  String resp = httpPost("/api/auth/login", body);
  if (resp.length() == 0) return false;

  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, resp)) return false;

  if (doc.containsKey("error")) {
    errorMessage = doc["error"].as<String>();
    return false;
  }

  const char* tok = doc["token"] | "";
  if (strlen(tok) == 0) {
    errorMessage = "Auth token missing";
    return false;
  }
  authToken = String(tok);
  return true;
}

// ============================================================
//  PAIR CART
// ============================================================
bool pairCart() {
  String body = "{\"cart_id\":\"" + String(CART_ID) + "\"}";
  String resp = httpPost("/api/cart/pair", body, true);
  if (resp.length() == 0) return false;

  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, resp)) return false;
  return doc["success"] | false;
}

// ============================================================
//  SYNC
// ============================================================
bool syncCart() {
  String body = "{\"cart_id\":\"" + String(CART_ID) + "\"}";
  String resp = httpPost("/api/cart/sync", body);
  if (resp.length() == 0) return false;

  StaticJsonDocument<4096> doc;
  if (deserializeJson(doc, resp)) return false;

  JsonObject session = doc["session"];
  if (session.isNull()) return false;

  cartIsDocked  = session["isDocked"] | false;
  subtotalCents = session["subtotalCents"] | 0;
  taxCents      = session["taxCents"] | 0;
  totalCents    = session["totalCents"] | 0;

  sessionItems = "";
  JsonArray items = session["items"];
  for (JsonObject it : items) {
    const char* nm = it["name"];
    int qty = it["quantity"] | 1;
    sessionItems += String(qty) + "x " + String(nm) + "\n";
  }
  return true;
}

// ============================================================
//  SCAN ITEM
// ============================================================
bool scanItem(const String& uid) {
  String body = "{\"cart_id\":\"" + String(CART_ID) +
                "\",\"rfid_tag\":\"" + uid +
                "\",\"action\":\"toggle\"}";
  String resp = httpPost("/api/hardware/scan-item", body);
  if (resp.length() == 0) {
    errorMessage = "Network error";
    return false;
  }

  StaticJsonDocument<4096> doc;
  if (deserializeJson(doc, resp)) {
    errorMessage = "Bad response";
    return false;
  }

  if (doc.containsKey("error")) {
    errorMessage = doc["error"].as<String>();
    return false;
  }

  JsonObject session = doc["session"];
  if (session.isNull()) {
    errorMessage = "No session";
    return false;
  }

  cartIsDocked  = session["isDocked"] | false;
  subtotalCents = session["subtotalCents"] | 0;
  taxCents      = session["taxCents"] | 0;
  totalCents    = session["totalCents"] | 0;

  sessionItems = "";
  JsonArray items = session["items"];
  for (JsonObject it : items) {
    const char* nm = it["name"];
    int qty = it["quantity"] | 1;
    sessionItems += String(qty) + "x " + String(nm) + "\n";
  }
  return true;
}

// ============================================================
//  RESET CART (cancel shopping)
// ============================================================
bool resetCart() {
  String body = "{\"cart_id\":\"" + String(CART_ID) + "\"}";
  String resp = httpPost("/api/cart/reset", body);
  if (resp.length() == 0) return false;

  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, resp)) return false;
  return doc["success"] | false;
}

// ============================================================
//  WALLET PAY
// ============================================================
String walletPay(const String& pin) {
  String body = "{\"cart_id\":\"" + String(CART_ID) +
                "\",\"pin\":\"" + pin + "\"}";
  return httpPost("/api/wallet/pay", body, true);
}

// ============================================================
//  QR CODE — using ESP-IDF built-in library (esp_qrcode)
// ============================================================
void qr_display_callback(esp_qrcode_handle_t qrcode) {
  int size = esp_qrcode_get_size(qrcode);

  // Fit QR to 200x200 region on the 240x240 screen
  int maxPixels = 200;
  int moduleSize = maxPixels / size;
  if (moduleSize < 2) moduleSize = 2;

  int qrPixels = size * moduleSize;
  int xOffset = (240 - qrPixels) / 2;
  int yOffset = 52;   // below header

  // White background for contrast
  tft.fillRect(xOffset - 4, yOffset - 4, qrPixels + 8, qrPixels + 8, ST77XX_WHITE);

  // Draw dark modules
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

void drawQRCodeOnTFT(const char* url) {
  esp_qrcode_config_t cfg = ESP_QRCODE_CONFIG_DEFAULT();
  cfg.display_func = qr_display_callback;
  cfg.max_qrcode_version = 10;
  cfg.qrcode_ecc_level = ESP_QRCODE_ECC_LOW;

  esp_qrcode_generate(&cfg, url);
}

// ============================================================
//  SCREENS
// ============================================================
void showIdle() {
  tftClear();
  tftHeader("SmartCart", "Ready to shop");
  tftCenter(80, "Welcome", ST77XX_ACCENT, 3);
  tftCenter(120, "Press any key", ST77XX_WHITE, 2);
  tftCenter(150, "to begin", ST77XX_WHITE, 2);
  tftHint("SmartCart IoT - cart_004");
}

void showPhoneEntry() {
  tftClear();
  tftHeader("Enter Phone", "10 digits");
  tftLine(60, "Phone number:", ST77XX_MUTED, 1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(3);
  tft.setCursor(12, 85);
  tft.print(typed.length() ? typed.c_str() : "_");
  tftHint("* clear     # continue");
}

void showNotRegistered() {
  tftClear();
  tftHeader("Not Found", "");
  tftCenter(80, "Number not", ST77XX_RED, 2);
  tftCenter(110, "registered", ST77XX_RED, 2);
  tftCenter(160, "Please register", ST77XX_MUTED, 1);
  tftCenter(180, "at the kiosk", ST77XX_MUTED, 1);
}

void showWelcome() {
  tftClear();
  tftHeader("Welcome", "");
  tftCenter(70, "Hi,", ST77XX_ACCENT, 2);
  String name = customerName;
  if (name.length() > 16) name = name.substring(0, 15) + ".";
  tftCenter(105, name.c_str(), ST77XX_WHITE, 2);
  tftHint("Press # to continue");
}

void showModeMenu() {
  tftClear();
  tftHeader("Choose Mode", "How are you shopping?");
  tftLine(70, "1", ST77XX_ACCENT, 3);
  tftLine(80, "  Website", ST77XX_WHITE, 2);
  tftLine(120, "2", ST77XX_ACCENT, 3);
  tftLine(130, "  Manual", ST77XX_WHITE, 2);
  tftHint("Press 1 or 2");
}

void showQR() {
  tftClear();
  tftHeader("Pair Cart", "Scan with your phone");

  String fullUrl = String(PAIR_BASE_URL) + String(CART_ID);
  Serial.print("QR URL: ");
  Serial.println(fullUrl);

  drawQRCodeOnTFT(fullUrl.c_str());

  // Footer
  tft.fillRect(0, 218, 240, 22, ST77XX_DARK);
  tft.setTextColor(ST77XX_ACCENT);
  tft.setTextSize(1);
  tft.setCursor(8, 225);
  tft.print("Waiting for phone to pair...");
}

void showPinEntry(const char* title) {
  tftClear();
  tftHeader(title, "4 to 6 digits");
  tftLine(60, "PIN:", ST77XX_MUTED, 1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(3);
  tft.setCursor(12, 85);
  String masked = "";
  for (unsigned int i = 0; i < typed.length(); i++) masked += "*";
  tft.print(masked.length() ? masked.c_str() : "_");
  tftHint("* clear     # continue");
}

void showScanMode() {
  tftClear();
  tftHeader("Scanning", "Tap items on the reader");

  if (sessionItems.length() == 0) {
    tft.setTextColor(ST77XX_MUTED);
    tft.setTextSize(2);
    tft.setCursor(12, 80);
    tft.print("(empty)");
  } else {
    tft.setTextColor(ST77XX_WHITE);
    tft.setTextSize(1);
    tft.setCursor(12, 56);
    tft.print(sessionItems);
  }

  tft.fillRect(0, 180, 240, 40, ST77XX_NAVY);
  tft.setTextColor(ST77XX_ACCENT);
  tft.setTextSize(1);
  tft.setCursor(12, 186);
  tft.print("TOTAL");
  tftTextRight(rands(totalCents).c_str(), 228, 192, ST77XX_WHITE, 3);

  tftHint("Scan item  |  # = cancel");
}

void showConfirmCancel() {
  tftClear();
  tftHeader("Cancel shopping?", "");
  tftCenter(80, "Clear cart and", ST77XX_WHITE, 2);
  tftCenter(110, "return to idle?", ST77XX_WHITE, 2);
  tftLine(180, "# = yes, cancel", ST77XX_RED, 1);
  tftLine(196, "* = no, go back", ST77XX_GREEN, 1);
}

void showCartCleared() {
  tftClear();
  tftHeader("Cleared", "");
  tftCenter(100, "Cart cleared", ST77XX_GREEN, 3);
  tftCenter(160, "Returning to idle", ST77XX_MUTED, 1);
}

void showDocked() {
  tftClear();
  tftHeader("Payment", "Cart docked");
  tftCenter(80, "Payment", ST77XX_GREEN, 3);
  tftCenter(120, "Unlocked", ST77XX_GREEN, 3);
  tftCenter(180, rands(totalCents).c_str(), ST77XX_ACCENT, 2);
  tftHint("Proceed to pay");
}

void showPaymentDone(bool ok, const String& message) {
  tftClear();
  tftHeader(ok ? "Success" : "Failed", "");
  tftCenter(90, ok ? "SUCCESS" : "FAILED",
            ok ? ST77XX_GREEN : ST77XX_RED, 3);
  tftCenter(140, message.c_str(), ST77XX_WHITE, 1);
  tftCenter(180, "Thank you!", ST77XX_ACCENT, 2);
}

// ============================================================
//  SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== SmartCart cart_004 ===");

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  digitalWrite(RED_LED, LOW);

  SPI_TFT.begin(TFT_SCK, -1, TFT_MOSI, TFT_CS);
  tft.init(240, 240, SPI_MODE3);
  tft.setRotation(0);
  tftClear();
  tftHeader("Booting...", "");

  SPI.begin(RC522_SCK, RC522_MISO, RC522_MOSI, RC522_SS);
  rfid.PCD_Init();
  delay(50);

  tftLine(80, "Connecting WiFi...", ST77XX_MUTED, 1);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(300);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi: " + WiFi.localIP().toString());
    tftLine(110, "WiFi connected", ST77XX_GREEN, 1);
  } else {
    Serial.println("\nWiFi FAILED");
    tftLine(110, "WiFi FAILED", ST77XX_RED, 1);
  }

  delay(800);
  currentState = ST_IDLE;
  stateEnteredAt = millis();
  showIdle();
}

// ============================================================
//  MAIN LOOP
// ============================================================
void loop() {
  char key = keypad.getKey();
  unsigned long now = millis();

  if (errorMessage.length() > 0 && (now - errorShownAt) > 3000) {
    errorMessage = "";
    if (currentState == ST_SCAN_MODE) showScanMode();
  }

  // ---------------- IDLE ----------------
  if (currentState == ST_IDLE) {
    if (key) {
      beep();
      typed = "";
      phoneNumber = "";
      customerName = "";
      customerId = "";
      authToken = "";
      errorMessage = "";
      currentState = ST_PHONE_ENTRY;
      stateEnteredAt = now;
      showPhoneEntry();
    }
    return;
  }

  // ---------------- PHONE ENTRY ----------------
  if (currentState == ST_PHONE_ENTRY) {
    if (key) {
      beep();
      if (key == '*') {
        typed = "";
      } else if (key == '#') {
        if (typed.length() >= 10) {
          phoneNumber = typed;
          currentState = ST_LOOKING_UP;
          stateEnteredAt = now;
          tftClear();
          tftHeader("Looking up...", "");
        }
      } else {
        if (typed.length() < 10) typed += key;
      }
      showPhoneEntry();
    }
    return;
  }

  // ---------------- LOOKING UP ----------------
  if (currentState == ST_LOOKING_UP) {
    String name, id;
    if (lookupCustomer(phoneNumber, name, id)) {
      customerName = name;
      customerId   = id;
      beepSuccess();
      currentState = ST_WELCOME;
      stateEnteredAt = now;
      showWelcome();
    } else {
      beepError();
      currentState = ST_NOT_REGISTERED;
      stateEnteredAt = now;
      showNotRegistered();
    }
    return;
  }

  // ---------------- NOT REGISTERED ----------------
  if (currentState == ST_NOT_REGISTERED) {
    if (now - stateEnteredAt > 5000) {
      typed = "";
      currentState = ST_PHONE_ENTRY;
      stateEnteredAt = now;
      showPhoneEntry();
    }
    return;
  }

  // ---------------- WELCOME ----------------
  if (currentState == ST_WELCOME) {
    if (key == '#') {
      beep();
      currentState = ST_MODE_MENU;
      stateEnteredAt = now;
      showModeMenu();
    }
    return;
  }

  // ---------------- MODE MENU ----------------
  if (currentState == ST_MODE_MENU) {
    if (key == '1') {
      beep();
      currentState = ST_WEBSITE_QR;
      stateEnteredAt = now;
      lastPollAt = 0;
      showQR();
    } else if (key == '2') {
      beep();
      typed = "";
      currentState = ST_MANUAL_PIN;
      stateEnteredAt = now;
      showPinEntry("Enter PIN");
    }
    return;
  }

  // ---------------- WEBSITE QR ----------------
  if (currentState == ST_WEBSITE_QR) {
    if (now - lastPollAt > 1500) {
      lastPollAt = now;
      String body = "{\"cart_id\":\"" + String(CART_ID) + "\"}";
      String resp = httpPost("/api/cart/sync", body);
      if (resp.length() > 0) {
        StaticJsonDocument<2048> doc;
        if (!deserializeJson(doc, resp)) {
          if (!doc["session"].isNull()) {
            beepSuccess();
            syncCart();
            currentState = ST_SCAN_MODE;
            stateEnteredAt = now;
            showScanMode();
          }
        }
      }
    }
    return;
  }

  // ---------------- MANUAL PIN ----------------
  if (currentState == ST_MANUAL_PIN) {
    if (key) {
      beep();
      if (key == '*') {
        typed = "";
      } else if (key == '#') {
        if (typed.length() >= 4) {
          tftClear();
          tftHeader("Signing in...", "");
          if (login(phoneNumber, typed)) {
            tftHeader("Pairing cart...", "");
            if (pairCart()) {
              beepSuccess();
              syncCart();
              typed = "";
              currentState = ST_SCAN_MODE;
              stateEnteredAt = now;
              showScanMode();
            } else {
              beepError();
              errorMessage = "Pairing failed";
              errorShownAt = now;
              showScanMode();
              tftError(errorMessage.c_str());
              delay(1500);
              typed = "";
              currentState = ST_MODE_MENU;
              stateEnteredAt = now;
              showModeMenu();
            }
          } else {
            beepError();
            if (errorMessage.length() == 0) errorMessage = "Wrong PIN";
            errorShownAt = now;
            showPinEntry("Enter PIN");
            tftError(errorMessage.c_str());
            delay(1800);
            typed = "";
            currentState = ST_MANUAL_PIN;
            stateEnteredAt = now;
            errorMessage = "";
            showPinEntry("Enter PIN");
          }
        }
      } else {
        if (typed.length() < 6) typed += key;
      }
      showPinEntry("Enter PIN");
    }
    return;
  }

  // ---------------- SCAN MODE ----------------
  if (currentState == ST_SCAN_MODE) {
    if (key) {
      Serial.print("[ScanMode] Key: ");
      Serial.println(key);
      if (key == '#') {
        beep();
        currentState = ST_CONFIRM_CANCEL;
        stateEnteredAt = now;
        showConfirmCancel();
        return;
      }
      lastPollAt = now;
      return;
    }

    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      String uid = "";
      for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) uid += "0";
        uid += String(rfid.uid.uidByte[i], HEX);
      }
      uid.toUpperCase();
      Serial.println("UID: " + uid);
      rfid.PICC_HaltA();

      if (uid != lastUID || (now - lastUIDAt > 2000)) {
        lastUID = uid;
        lastUIDAt = now;
        if (scanItem(uid)) {
          beepSuccess();
          showScanMode();
        } else {
          beepError();
          errorShownAt = now;
          showScanMode();
          tftError(errorMessage.length() ? errorMessage.c_str() : "Scan failed");
        }
      }
    }

    if (now - lastPollAt > 1000) {
      lastPollAt = now;
      syncCart();
      if (cartIsDocked) {
        beepSuccess();
        digitalWrite(RED_LED, HIGH);
        currentState = ST_DOCKED_PAYMENT;
        stateEnteredAt = now;
        showDocked();
      } else {
        showScanMode();
      }
    }
    return;
  }

  // ---------------- CONFIRM CANCEL ----------------
  if (currentState == ST_CONFIRM_CANCEL) {
    if (key) {
      beep();
      if (key == '#') {
        currentState = ST_CART_CLEARED;
        stateEnteredAt = now;
        tftClear();
        tftHeader("Clearing cart...", "");
        resetCart();
        currentState = ST_CART_CLEARED;
        stateEnteredAt = now;
        showCartCleared();
      } else if (key == '*') {
        currentState = ST_SCAN_MODE;
        stateEnteredAt = now;
        lastPollAt = now;
        showScanMode();
      }
    }
    return;
  }

  // ---------------- CART CLEARED ----------------
  if (currentState == ST_CART_CLEARED) {
    if (now - stateEnteredAt > 2000) {
      typed = "";
      phoneNumber = "";
      customerName = "";
      customerId = "";
      authToken = "";
      sessionItems = "";
      subtotalCents = 0;
      taxCents = 0;
      totalCents = 0;
      cartIsDocked = false;
      lastUID = "";
      errorMessage = "";
      digitalWrite(RED_LED, LOW);
      currentState = ST_IDLE;
      stateEnteredAt = now;
      showIdle();
    }
    return;
  }

  // ---------------- DOCKED ----------------
  if (currentState == ST_DOCKED_PAYMENT) {
    if (authToken.length() == 0) {
      if (now - stateEnteredAt > 5000) {
        currentState = ST_PAYMENT_DONE;
        stateEnteredAt = now;
        showPaymentDone(true, "Paid via website");
        digitalWrite(RED_LED, LOW);
      }
      return;
    }
    if (now - stateEnteredAt > 1500) {
      typed = "";
      currentState = ST_MANUAL_PAY_PIN;
      stateEnteredAt = now;
      showPinEntry("Pay PIN");
    }
    return;
  }

  // ---------------- MANUAL PAY PIN ----------------
  if (currentState == ST_MANUAL_PAY_PIN) {
    if (key) {
      beep();
      if (key == '*') {
        typed = "";
      } else if (key == '#') {
        if (typed.length() >= 4) {
          tftClear();
          tftHeader("Paying...", "");
          String resp = walletPay(typed);
          typed = "";
          if (resp.indexOf("\"success\":true") >= 0) {
            beepSuccess();
            currentState = ST_PAYMENT_DONE;
            stateEnteredAt = now;
            showPaymentDone(true, "Wallet debited");
            digitalWrite(RED_LED, LOW);
          } else {
            beepError();
            errorMessage = "Payment failed";
            errorShownAt = now;
            showPinEntry("Pay PIN");
            tftError(errorMessage.c_str());
            delay(2200);
            currentState = ST_MANUAL_PAY_PIN;
            stateEnteredAt = now;
            showPinEntry("Pay PIN");
          }
        }
      } else {
        if (typed.length() < 6) typed += key;
      }
      showPinEntry("Pay PIN");
    }
    return;
  }

  // ---------------- PAYMENT DONE ----------------
  if (currentState == ST_PAYMENT_DONE) {
    if (now - stateEnteredAt > 6000) {
      typed = "";
      phoneNumber = "";
      customerName = "";
      customerId = "";
      authToken = "";
      sessionItems = "";
      subtotalCents = 0;
      taxCents = 0;
      totalCents = 0;
      cartIsDocked = false;
      lastUID = "";
      errorMessage = "";
      currentState = ST_IDLE;
      stateEnteredAt = now;
      showIdle();
    }
    return;
  }
}