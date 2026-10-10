/*
 * ============================================================
 *  SmartCart — ESP32 Cart Firmware
 * ============================================================
 *  Cart ID: cart_004
 *  Backend: https://smart-cart-5qod.vercel.app
 *  Cookie name: smartcart_session
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

// ============================================================
//  CONFIGURATION
// ============================================================
const char* WIFI_SSID     = "TECNO SPARK Go 2";
const char* WIFI_PASSWORD = "vddh30npbm211912";

const char* BACKEND_URL   = "https://smart-cart-5qod.vercel.app";
const char* CART_ID       = "cart_004";
const char* COOKIE_NAME   = "smartcart_session";

// Extra color
#define ST77XX_NAVY 0x000F

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
unsigned long stateEnteredAt = 0;
unsigned long lastPollAt = 0;

long subtotalCents = 0;
long taxCents = 0;
long totalCents = 0;
bool cartIsDocked = false;
String sessionItems = "";

// ============================================================
//  BEEP
// ============================================================
void beep(int ms = 80) { tone(BUZZER_PIN, 2000, ms); }
void beepError() { tone(BUZZER_PIN, 500, 300); }
void beepSuccess() {
  tone(BUZZER_PIN, 2500, 60);
  delay(80);
  tone(BUZZER_PIN, 3000, 60);
}

// ============================================================
//  TFT HELPERS
// ============================================================
void tftClear() { tft.fillScreen(ST77XX_BLACK); }

void tftHeader(const char* title) {
  tft.fillRect(0, 0, 240, 32, ST77XX_NAVY);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(8, 8);
  tft.print(title);
}

void tftLine(int y, const char* text, uint16_t color = ST77XX_WHITE, uint8_t size = 2) {
  tft.setTextColor(color);
  tft.setTextSize(size);
  tft.setCursor(10, y);
  tft.println(text);
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
    Serial.println("[Cookie] Sending: " + ck.substring(0, 50) + "...");
  }

  http.setTimeout(10000);
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
//  LOGIN — extracts token from JSON body
// ============================================================
bool login(const String& phone, const String& pin) {
  String body = "{\"phone_number\":\"" + phone + "\",\"pin\":\"" + pin + "\"}";
  String resp = httpPost("/api/auth/login", body);
  if (resp.length() == 0) return false;

  StaticJsonDocument<2048> doc;
  DeserializationError err = deserializeJson(doc, resp);
  if (err) {
    Serial.print("[Login] JSON parse error: ");
    Serial.println(err.c_str());
    return false;
  }

  if (doc.containsKey("error")) {
    Serial.print("[Login] Server error: ");
    Serial.println(doc["error"].as<String>());
    return false;
  }

  const char* tok = doc["token"] | "";
  if (strlen(tok) == 0) {
    Serial.println("[Login] ERROR: token missing from response");
    return false;
  }
  authToken = String(tok);

  Serial.print("[Login] Token stored (");
  Serial.print(COOKIE_NAME);
  Serial.print("=");
  Serial.print(authToken.substring(0, 24));
  Serial.println("...)");
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
//  SYNC CART
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
//  WALLET PAY
// ============================================================
String walletPay(const String& pin) {
  String body = "{\"cart_id\":\"" + String(CART_ID) +
                "\",\"pin\":\"" + pin + "\"}";
  return httpPost("/api/wallet/pay", body, true);
}

// ============================================================
//  SCREENS
// ============================================================
void showIdle() {
  tftClear();
  tftHeader("SmartCart");
  tftLine(60, "Welcome!", ST77XX_CYAN, 2);
  tftLine(100, "Press any key", ST77XX_WHITE, 2);
  tftLine(130, "to begin", ST77XX_WHITE, 2);
}

void showPhoneEntry() {
  tftClear();
  tftHeader("Enter Phone");
  tftLine(50, "Phone number:", ST77XX_WHITE, 1);
  tftLine(80, typed.c_str(), ST77XX_GREEN, 2);
  tftLine(200, "* = clear", ST77XX_ORANGE, 1);
  tftLine(215, "# = continue", ST77XX_ORANGE, 1);
}

void showNotRegistered() {
  tftClear();
  tftHeader("Not Found");
  tftLine(80, "Number not", ST77XX_RED, 2);
  tftLine(110, "registered.", ST77XX_RED, 2);
  tftLine(160, "Please register", ST77XX_WHITE, 1);
  tftLine(180, "at the kiosk.", ST77XX_WHITE, 1);
}

void showWelcome() {
  tftClear();
  tftHeader("Welcome");
  tftLine(70, "Hi,", ST77XX_CYAN, 2);
  tftLine(100, customerName.c_str(), ST77XX_GREEN, 2);
  tftLine(200, "Press # to continue", ST77XX_WHITE, 1);
}

void showModeMenu() {
  tftClear();
  tftHeader("Choose Mode");
  tftLine(70, "1 = Website", ST77XX_CYAN, 2);
  tftLine(120, "2 = Manual", ST77XX_CYAN, 2);
}

void showQrPlaceholder() {
  tftClear();
  tftHeader("Pair Cart");
  tftLine(50, "Scan QR on phone", ST77XX_WHITE, 1);
  tft.drawRect(60, 80, 120, 120, ST77XX_WHITE);
  tftLine(110, "QR CODE", ST77XX_GREEN, 2);
  tftLine(220, "Waiting...", ST77XX_YELLOW, 1);
}

void showPinEntry(const char* title) {
  tftClear();
  tftHeader(title);
  tftLine(50, "Enter PIN:", ST77XX_WHITE, 1);
  tftLine(80, typed.c_str(), ST77XX_GREEN, 2);
  tftLine(200, "* = clear", ST77XX_ORANGE, 1);
  tftLine(215, "# = continue", ST77XX_ORANGE, 1);
}

void showScanMode() {
  tftClear();
  tftHeader("Scan Items");
  tftLine(45, sessionItems.c_str(), ST77XX_WHITE, 1);
  tft.fillRect(0, 200, 240, 40, ST77XX_NAVY);
  tftLine(210, ("Total: " + rands(totalCents)).c_str(), ST77XX_YELLOW, 2);
}

void showDocked() {
  tftClear();
  tftHeader("Docked");
  tftLine(70, "Payment", ST77XX_GREEN, 3);
  tftLine(120, "Unlocked", ST77XX_GREEN, 3);
  tftLine(200, ("Total: " + rands(totalCents)).c_str(), ST77XX_YELLOW, 1);
}

void showPaymentDone(bool ok, const String& message) {
  tftClear();
  tftHeader("Payment");
  tftLine(80, ok ? "SUCCESS" : "FAILED", ok ? ST77XX_GREEN : ST77XX_RED, 3);
  tftLine(140, message.c_str(), ST77XX_WHITE, 1);
  tftLine(200, "Thank you!", ST77XX_CYAN, 1);
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
  tftHeader("Booting...");

  SPI.begin(RC522_SCK, RC522_MISO, RC522_MOSI, RC522_SS);
  rfid.PCD_Init();
  delay(50);

  tftLine(80, "Connecting WiFi...", ST77XX_WHITE, 1);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(300);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
    tftLine(110, "WiFi OK", ST77XX_GREEN, 1);
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

  if (currentState == ST_IDLE) {
    if (key) {
      beep();
      typed = "";
      phoneNumber = "";
      customerName = "";
      customerId = "";
      authToken = "";
      currentState = ST_PHONE_ENTRY;
      stateEnteredAt = now;
      showPhoneEntry();
    }
    return;
  }

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
          tftHeader("Looking up...");
        }
      } else {
        if (typed.length() < 10) typed += key;
      }
      showPhoneEntry();
    }
    return;
  }

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

  if (currentState == ST_NOT_REGISTERED) {
    if (now - stateEnteredAt > 5000) {
      typed = "";
      currentState = ST_PHONE_ENTRY;
      stateEnteredAt = now;
      showPhoneEntry();
    }
    return;
  }

  if (currentState == ST_WELCOME) {
    if (key == '#') {
      beep();
      currentState = ST_MODE_MENU;
      stateEnteredAt = now;
      showModeMenu();
    }
    return;
  }

  if (currentState == ST_MODE_MENU) {
    if (key == '1') {
      beep();
      currentState = ST_WEBSITE_QR;
      stateEnteredAt = now;
      lastPollAt = 0;
      showQrPlaceholder();
    } else if (key == '2') {
      beep();
      typed = "";
      currentState = ST_MANUAL_PIN;
      stateEnteredAt = now;
      showPinEntry("Enter PIN");
    }
    return;
  }

  if (currentState == ST_WEBSITE_QR) {
    if (now - lastPollAt > 2000) {
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

  if (currentState == ST_MANUAL_PIN) {
    if (key) {
      beep();
      if (key == '*') {
        typed = "";
      } else if (key == '#') {
        if (typed.length() >= 4) {
          tftClear();
          tftHeader("Logging in...");
          if (login(phoneNumber, typed)) {
            if (pairCart()) {
              beepSuccess();
              syncCart();
              typed = "";
              currentState = ST_SCAN_MODE;
              stateEnteredAt = now;
              showScanMode();
            } else {
              beepError();
              tftLine(80, "Pair failed", ST77XX_RED, 2);
              delay(2000);
              typed = "";
              currentState = ST_MODE_MENU;
              stateEnteredAt = now;
              showModeMenu();
            }
          } else {
            beepError();
            tftLine(80, "Wrong PIN", ST77XX_RED, 2);
            delay(2000);
            typed = "";
            currentState = ST_MANUAL_PIN;
            stateEnteredAt = now;
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

  if (currentState == ST_SCAN_MODE) {
    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      String uid = "";
      for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) uid += "0";
        uid += String(rfid.uid.uidByte[i], HEX);
      }
      uid.toUpperCase();
      Serial.println("UID: " + uid);
      rfid.PICC_HaltA();

      if (uid != lastUID) {
        lastUID = uid;
        if (scanItem(uid)) {
          beepSuccess();
          showScanMode();
        } else {
          beepError();
        }
      }
    }

    if (now - lastPollAt > 3000) {
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

  if (currentState == ST_MANUAL_PAY_PIN) {
    if (key) {
      beep();
      if (key == '*') {
        typed = "";
      } else if (key == '#') {
        if (typed.length() >= 4) {
          tftClear();
          tftHeader("Paying...");
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
            tftLine(80, "Payment failed", ST77XX_RED, 2);
            delay(2500);
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
      currentState = ST_IDLE;
      stateEnteredAt = now;
      showIdle();
    }
    return;
  }
}