#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <TFT_eSPI.h>
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

#define COLOR_NAVY   0x000F
#define COLOR_DARK   0x0841
#define COLOR_ACCENT 0x05BF
#define COLOR_MUTED  0x8410
#define COLOR_AMBER  0xFD20
#define COLOR_RED    TFT_RED
#define COLOR_GREEN  TFT_GREEN
#define COLOR_WHITE  TFT_WHITE
#define COLOR_BLACK  TFT_BLACK

// HARDWARE PINS
#define RC522_SS   5
#define RC522_RST  4
#define RC522_SCK  18
#define RC522_MISO 19
#define RC522_MOSI 23
#define BUZZER_PIN 25
#define RED_LED    26

const int keypadPins[] = {16, 17, 27, 22, 32, 21, 33};

// OBJECTS
TFT_eSPI tft = TFT_eSPI(); 
MFRC522 rfid(RC522_SS, RC522_RST);

// STATE MACHINE
enum CartState {
  ST_IDLE, ST_PHONE_ENTRY, ST_LOOKING_UP, ST_NOT_REGISTERED,
  ST_WELCOME, ST_MODE_MENU, ST_WEBSITE_QR, ST_MANUAL_PIN,
  ST_SCAN_MODE, ST_CONFIRM_CANCEL, ST_PAYMENT_UNLOCKED,
  ST_PAY_PIN, ST_PAYMENT_DONE, ST_ALARM, ST_ALARM_PIN, ST_ALARM_CHOICE
};

CartState currentState = ST_IDLE;
String typed = "", phoneNumber = "", customerName = "", customerId = "", authToken = "", lastUID = "", errorMessage = "";
unsigned long lastUIDAt = 0, errorShownAt = 0, stateEnteredAt = 0, lastPollAt = 0, lastBuzzToggleAt = 0;
long subtotalCents = 0, taxCents = 0, totalCents = 0;
bool cartIsDocked = false, sawActiveSession = false, isManualMode = false, lastKnownDocked = false, buzzerOn = false;
String sessionItems = "", paymentStatus = "unpaid";

// HELPERS
void beep(int ms = 70) { tone(BUZZER_PIN, 2200, ms); }
void beepError() { tone(BUZZER_PIN, 500, 300); }
void beepSuccess() { tone(BUZZER_PIN, 2500, 60); delay(70); tone(BUZZER_PIN, 3200, 70); }

void tftClear() { tft.fillScreen(COLOR_BLACK); }
void tftHeader(const char* title, const char* subtitle = nullptr) {
  tft.fillRect(0, 0, 240, 44, COLOR_NAVY);
  tft.setTextColor(COLOR_WHITE, COLOR_NAVY); tft.setTextSize(2); tft.setCursor(12, 10); tft.print(title);
  if (subtitle && strlen(subtitle) > 0) {
    tft.setTextColor(COLOR_ACCENT, COLOR_NAVY); tft.setTextSize(1); tft.setCursor(12, 32); tft.print(subtitle);
  }
}
void tftCenter(int y, const char* text, uint16_t color = COLOR_WHITE, uint8_t size = 2) {
  int16_t w = tft.textWidth(text, size); tft.setTextSize(size); tft.setTextColor(color, COLOR_BLACK); tft.setCursor((240 - w) / 2, y); tft.print(text);
}
void tftLine(int y, const char* text, uint16_t color = COLOR_WHITE, uint8_t size = 2) {
  tft.setTextColor(color, COLOR_BLACK); tft.setTextSize(size); tft.setCursor(12, y); tft.print(text);
}
void tftTextRight(const char* text, int16_t xRight, int16_t y, uint16_t color, uint8_t size) {
  int16_t w = tft.textWidth(text, size); tft.setTextSize(size); tft.setTextColor(color, COLOR_BLACK); tft.setCursor(xRight - w, y); tft.print(text);
}
void tftHint(const char* hint) {
  tft.fillRect(0, 218, 240, 22, COLOR_DARK); tft.setTextColor(COLOR_MUTED, COLOR_DARK); tft.setTextSize(1); tft.setCursor(8, 225); tft.print(hint);
}
void tftError(const char* msg) {
  tft.fillRect(0, 178, 240, 34, COLOR_RED); tft.setTextColor(COLOR_WHITE, COLOR_RED); tft.setTextSize(1); tft.setCursor(8, 186); tft.print(msg);
}
String rands(long cents) { char buf[24]; snprintf(buf, sizeof(buf), "R%ld.%02ld", cents / 100, cents % 100); return String(buf); }

// HTTP
String httpPost(const String& path, const String& jsonBody, bool useCookie = false) {
  if (WiFi.status() != WL_CONNECTED) return "";
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http; http.begin(client, String(BACKEND_URL) + path);
  http.addHeader("Content-Type", "application/json");
  if (useCookie && authToken.length() > 0) http.addHeader("Cookie", String(COOKIE_NAME) + "=" + authToken);
  http.setTimeout(3000); int code = http.POST(jsonBody); String response = http.getString(); http.end(); return response;
}

bool lookupCustomer(const String& phone, String& outName, String& outId) {
  String resp = httpPost("/api/customers/lookup", "{\"phone_number\":\"" + phone + "\"}");
  if (resp.length() == 0) return false;
  StaticJsonDocument<1024> doc; if (deserializeJson(doc, resp)) return false;
  if (!(doc["found"] | false)) return false;
  outName = doc["customer"]["name"].as<String>(); outId = doc["customer"]["id"].as<String>(); return true;
}

bool login(const String& phone, const String& pin) {
  String resp = httpPost("/api/auth/login", "{\"phone_number\":\"" + phone + "\",\"pin\":\"" + pin + "\"}");
  if (resp.length() == 0) return false;
  StaticJsonDocument<2048> doc; if (deserializeJson(doc, resp)) return false;
  if (doc.containsKey("error")) { errorMessage = doc["error"].as<String>(); return false; }
  const char* tok = doc["token"] | ""; if (strlen(tok) == 0) { errorMessage = "Auth token missing"; return false; }
  authToken = String(tok); return true;
}

bool pairCart() { return httpPost("/api/cart/pair", "{\"cart_id\":\"" + String(CART_ID) + "\"}", true).indexOf("true") > 0; }
bool confirmPayment() { return httpPost("/api/cart/confirm-payment", "{\"cart_id\":\"" + String(CART_ID) + "\"}", true).indexOf("true") > 0; }
bool verifyStaffPin(const String& pin) { return httpPost("/api/auth/staff-verify", "{\"pin\":\"" + pin + "\"}").indexOf("true") > 0; }
void notifyBackendAlarm() { httpPost("/api/cart/anti-theft-trigger", "{\"cart_id\":\"" + String(CART_ID) + "\",\"reason\":\"undocked_after_pending\"}"); }
bool clearAntiTheft(const char* action) { return httpPost("/api/cart/anti-theft-clear", "{\"cart_id\":\"" + String(CART_ID) + "\",\"action\":\"" + String(action) + "\"}").indexOf("true") > 0; }
bool resetCart() { return httpPost("/api/cart/reset", "{\"cart_id\":\"" + String(CART_ID) + "\"}").indexOf("true") > 0; }

int syncCartState() {
  String resp = httpPost("/api/cart/sync", "{\"cart_id\":\"" + String(CART_ID) + "\"}");
  if (resp.length() == 0) return -2;
  StaticJsonDocument<4096> doc; if (deserializeJson(doc, resp)) return -2;
  JsonObject session = doc["session"]; if (session.isNull()) return -1;
  cartIsDocked = session["isDocked"] | false; paymentStatus = session["paymentStatus"].as<String>();
  if (paymentStatus.length() == 0) paymentStatus = "unpaid";
  subtotalCents = session["subtotalCents"] | 0; taxCents = session["taxCents"] | 0; totalCents = session["totalCents"] | 0;
  sessionItems = ""; JsonArray items = session["items"];
  for (JsonObject it : items) sessionItems += String(it["quantity"] | 1) + "x " + String(it["name"]) + "\n";
  return cartIsDocked ? 1 : 0;
}

bool scanItem(const String& uid) {
  String resp = httpPost("/api/hardware/scan-item", "{\"cart_id\":\"" + String(CART_ID) + "\",\"rfid_tag\":\"" + uid + "\",\"action\":\"toggle\"}");
  if (resp.length() == 0) { errorMessage = "Network error"; return false; }
  StaticJsonDocument<4096> doc; if (deserializeJson(doc, resp)) { errorMessage = "Bad response"; return false; }
  if (doc.containsKey("error")) { errorMessage = doc["error"].as<String>(); return false; }
  JsonObject session = doc["session"]; if (session.isNull()) { errorMessage = "No session"; return false; }
  cartIsDocked = session["isDocked"] | false; subtotalCents = session["subtotalCents"] | 0; taxCents = session["taxCents"] | 0; totalCents = session["totalCents"] | 0;
  sessionItems = ""; JsonArray items = session["items"];
  for (JsonObject it : items) sessionItems += String(it["quantity"] | 1) + "x " + String(it["name"]) + "\n";
  return true;
}

String walletPayWithLogin(const String& pin) {
  if (authToken.length() == 0) { if (!login(phoneNumber, pin)) return "wrongpin"; }
  String resp = httpPost("/api/wallet/pay", "{\"cart_id\":\"" + String(CART_ID) + "\",\"pin\":\"" + pin + "\"}", true);
  if (resp.length() == 0) return "neterror";
  StaticJsonDocument<2048> doc; if (deserializeJson(doc, resp)) return "neterror";
  if (doc["success"] | false) return "ok";
  errorMessage = String(doc["error"] | ""); return "nofunds";
}

// SCREENS
void showIdle() { tftClear(); tftHeader("SmartCart", "Ready to shop"); tftCenter(80, "Welcome", COLOR_ACCENT, 3); tftCenter(120, "Press any key", COLOR_WHITE, 2); tftCenter(150, "to begin", COLOR_WHITE, 2); tftHint("SmartCart IoT - cart_004"); }
void showPhoneEntry() { tftClear(); tftHeader("Enter Phone", "10 digits"); tftLine(60, "Phone number:", COLOR_MUTED, 1); tft.setTextColor(COLOR_WHITE, COLOR_BLACK); tft.setTextSize(3); tft.setCursor(12, 85); tft.print(typed.length() ? typed.c_str() : "_"); tftHint("* clear     # continue"); }
void showNotRegistered() { tftClear(); tftHeader("Not Found", ""); tftCenter(80, "Number not", COLOR_RED, 2); tftCenter(110, "registered", COLOR_RED, 2); tftCenter(160, "Please register", COLOR_MUTED, 1); tftCenter(180, "at the kiosk", COLOR_MUTED, 1); }
void showWelcome() { tftClear(); tftHeader("Welcome", ""); tftCenter(70, "Hi,", COLOR_ACCENT, 2); String name = customerName; if (name.length() > 16) name = name.substring(0, 15) + "."; tftCenter(105, name.c_str(), COLOR_WHITE, 2); tftHint("Press # to continue"); }
void showModeMenu() { tftClear(); tftHeader("Choose Mode", "How are you shopping?"); tftLine(70, "1", COLOR_ACCENT, 3); tftLine(80, "  Website", COLOR_WHITE, 2); tftLine(120, "2", COLOR_ACCENT, 3); tftLine(130, "  Manual", COLOR_WHITE, 2); tftHint("Press 1 or 2"); }
void showQR() { tftClear(); drawQRCodeFullScreen((String(PAIR_BASE_URL) + String(CART_ID)).c_str()); tft.fillRect(0, 220, 240, 20, COLOR_BLACK); tft.setTextColor(COLOR_ACCENT, COLOR_BLACK); tft.setTextSize(1); tft.setCursor(6, 226); tft.print("Scan QR to pair cart"); }
void showPinEntry(const char* title) { tftClear(); tftHeader(title, "4 to 6 digits"); tftLine(60, "PIN:", COLOR_MUTED, 1); tft.setTextColor(COLOR_WHITE, COLOR_BLACK); tft.setTextSize(3); tft.setCursor(12, 85); String masked = ""; for (unsigned int i = 0; i < typed.length(); i++) masked += "*"; tft.print(masked.length() ? masked.c_str() : "_"); tftHint("* clear   # OK   0 = back"); }
void showScanMode() {
  tftClear(); tftHeader("Scanning", "Tap items on the reader");
  if (sessionItems.length() == 0) { tft.setTextColor(COLOR_MUTED, COLOR_BLACK); tft.setTextSize(2); tft.setCursor(12, 80); tft.print("(empty)"); }
  else { tft.setTextColor(COLOR_WHITE, COLOR_BLACK); tft.setTextSize(1); tft.setCursor(12, 56); tft.print(sessionItems); }
  tft.fillRect(0, 180, 240, 40, COLOR_NAVY); tft.setTextColor(COLOR_ACCENT, COLOR_NAVY); tft.setTextSize(1); tft.setCursor(12, 186); tft.print("TOTAL"); tftTextRight(rands(totalCents).c_str(), 228, 192, COLOR_WHITE, 3);
  if (cartIsDocked) { tft.fillRect(0, 218, 240, 22, COLOR_NAVY); tft.setTextColor(COLOR_AMBER, COLOR_NAVY); tft.setTextSize(1); tft.setCursor(8, 225); tft.print("Cart docked - scanning disabled"); }
  else if (paymentStatus == "pending") { tft.fillRect(0, 218, 240, 22, COLOR_AMBER); tft.setTextColor(COLOR_BLACK, COLOR_AMBER); tft.setTextSize(1); tft.setCursor(8, 225); tft.print("Payment ready - dock to unlock"); }
  else { tftHint("Scan item  |  # = cancel"); }
}
void showConfirmCancel() { tftClear(); tftHeader("Cancel shopping?", ""); tftCenter(80, "Clear cart and", COLOR_WHITE, 2); tftCenter(110, "return to idle?", COLOR_WHITE, 2); tftLine(180, "# = yes, cancel", COLOR_RED, 1); tftLine(196, "* = no, go back", COLOR_GREEN, 1); }
void showPaymentUnlocked() { tftClear(); tftHeader("Payment", "Cart docked"); tftCenter(70, "Payment", COLOR_GREEN, 3); tftCenter(105, "Unlocked", COLOR_GREEN, 3); tftCenter(160, rands(totalCents).c_str(), COLOR_ACCENT, 2); tftHint(isManualMode ? "Enter PIN to pay" : "# = pay from wallet"); }
void showPaymentDone(bool ok, const String& message) { tftClear(); tftHeader(ok ? "Success" : "Failed", ""); tftCenter(90, ok ? "SUCCESS" : "FAILED", ok ? COLOR_GREEN : COLOR_RED, 3); tftCenter(140, message.c_str(), COLOR_WHITE, 1); tftCenter(180, "Thank you!", COLOR_ACCENT, 2); }
void showAlarmScreen() { tftClear(); tft.fillRect(0, 0, 240, 60, COLOR_RED); tft.setTextColor(COLOR_WHITE, COLOR_RED); tft.setTextSize(2); tft.setCursor(12, 10); tft.print("ANTI-THEFT"); tft.setTextSize(1); tft.setCursor(12, 38); tft.print("ALERT ACTIVE"); tftCenter(90, "Please wait", COLOR_WHITE, 3); tftCenter(130, "for staff", COLOR_WHITE, 3); tft.fillRect(0, 180, 240, 40, COLOR_DARK); tft.setTextColor(COLOR_AMBER, COLOR_DARK); tft.setTextSize(1); tft.setCursor(12, 190); tft.print("Staff: press 0 to enter PIN"); }
void showStaffPinEntry() { tftClear(); tft.fillRect(0, 0, 240, 44, COLOR_RED); tft.setTextColor(COLOR_WHITE, COLOR_RED); tft.setTextSize(2); tft.setCursor(12, 10); tft.print("Staff PIN"); tft.setTextSize(1); tft.setCursor(12, 32); tft.print("Anti-theft reset"); tftLine(60, "Enter staff PIN:", COLOR_MUTED, 1); tft.setTextColor(COLOR_WHITE, COLOR_BLACK); tft.setTextSize(3); tft.setCursor(12, 85); String masked = ""; for (unsigned int i = 0; i < typed.length(); i++) masked += "*"; tft.print(masked.length() ? masked.c_str() : "_"); tftHint("* clear   # OK"); }
void showStaffChoice() { tftClear(); tft.fillRect(0, 0, 240, 60, COLOR_GREEN); tft.setTextColor(COLOR_WHITE, COLOR_GREEN); tft.setTextSize(2); tft.setCursor(12, 10); tft.print("ALARM CLEARED"); tft.setTextSize(1); tft.setCursor(12, 38); tft.print("Choose next action"); tftLine(80, "1 = Continue shopping", COLOR_WHITE, 2); tftLine(120, "2 = Cancel cart", COLOR_WHITE, 2); tftHint("Press 1 or 2"); }

void resetAllState() {
  typed = ""; phoneNumber = ""; customerName = ""; customerId = ""; authToken = ""; sessionItems = "";
  subtotalCents = 0; taxCents = 0; totalCents = 0; cartIsDocked = false; lastKnownDocked = false;
  sawActiveSession = false; isManualMode = false; lastUID = ""; errorMessage = ""; paymentStatus = "unpaid";
  digitalWrite(RED_LED, LOW); if (buzzerOn) { noTone(BUZZER_PIN); buzzerOn = false; }
}

void triggerAntiTheft() { currentState = ST_ALARM; stateEnteredAt = millis(); typed = ""; showAlarmScreen(); notifyBackendAlarm(); buzzerOn = true; }

// QR Callback
void qr_display_callback(esp_qrcode_handle_t qrcode) {
  int size = esp_qrcode_get_size(qrcode); int moduleSize = min(232 / size, 216 / size); if (moduleSize < 3) moduleSize = 3;
  int qrPixels = size * moduleSize; int xOffset = (240 - qrPixels) / 2; int yOffset = 4 + ((216 - qrPixels) / 2);
  tft.fillRect(xOffset - 2, yOffset - 2, qrPixels + 4, qrPixels + 4, COLOR_WHITE);
  for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) if (esp_qrcode_get_module(qrcode, x, y)) tft.fillRect(xOffset + x * moduleSize, yOffset + y * moduleSize, moduleSize, moduleSize, COLOR_BLACK);
}
void drawQRCodeFullScreen(const char* url) { esp_qrcode_config_t cfg = ESP_QRCODE_CONFIG_DEFAULT(); cfg.display_func = qr_display_callback; cfg.max_qrcode_version = 10; esp_qrcode_generate(&cfg, url); }

// CUSTOM KEYPAD SCANNER
char getCustomKey() {
  char pressedKey = 0;
  for (int sender = 0; sender < 7; sender++) {
    pinMode(keypadPins[sender], OUTPUT); digitalWrite(keypadPins[sender], LOW); delay(5);
    for (int receiver = 0; receiver < 7; receiver++) {
      if (sender == receiver) continue;
      if (digitalRead(keypadPins[receiver]) == LOW) {
        int s = keypadPins[sender]; int r = keypadPins[receiver];
        if ((s == 16 && r == 22) || (s == 22 && r == 16)) pressedKey = '0';
        if ((s == 17 && r == 27) || (s == 27 && r == 17)) pressedKey = '1';
        if ((s == 16 && r == 17) || (s == 17 && r == 16)) pressedKey = '2';
        if ((s == 17 && r == 32) || (s == 32 && r == 17)) pressedKey = '3';
        if ((s == 27 && r == 33) || (s == 33 && r == 27)) pressedKey = '4';
        if ((s == 16 && r == 33) || (s == 33 && r == 16)) pressedKey = '5';
        if ((s == 32 && r == 33) || (s == 33 && r == 32)) pressedKey = '6';
        if ((s == 27 && r == 21) || (s == 21 && r == 27)) pressedKey = '7';
        if ((s == 16 && r == 21) || (s == 21 && r == 16)) pressedKey = '8';
        if ((s == 32 && r == 21) || (s == 21 && r == 32)) pressedKey = '9';
        if ((s == 27 && r == 22) || (s == 22 && r == 27)) pressedKey = '*';
        if ((s == 22 && r == 32) || (s == 32 && r == 22)) pressedKey = '#';
      }
    }
    pinMode(keypadPins[sender], INPUT_PULLUP);
    if (pressedKey != 0) break;
  }
  return pressedKey;
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT); pinMode(RED_LED, OUTPUT); digitalWrite(RED_LED, LOW); noTone(BUZZER_PIN);
  for (int i = 0; i < 7; i++) pinMode(keypadPins[i], INPUT_PULLUP);
  
  tft.init(); tft.setRotation(1); tftClear(); tftHeader("Booting...", "Hardware Test");
  
  //SPI.begin(RC522_SCK, RC522_MISO, RC522_MOSI, RC522_SS);
  //rfid.PCD_Init(); delay(50);

  tftLine(80, "Connecting WiFi...", COLOR_MUTED, 1);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) { delay(300); }
  
  if (WiFi.status() == WL_CONNECTED) tftLine(110, "WiFi connected", COLOR_GREEN, 1);
  else tftLine(110, "WiFi FAILED", COLOR_RED, 1);
  
  delay(800);
  currentState = ST_IDLE; stateEnteredAt = millis(); showIdle();
}

void updateAlarmBuzzer() {
  if (!buzzerOn) return;
  unsigned long now = millis();
  if (now - lastBuzzToggleAt > 500) { lastBuzzToggleAt = now; tone(BUZZER_PIN, 3000, 400); }
}

void globalPoll() {
  if (!sawActiveSession) return;
  unsigned long now = millis();
  unsigned long interval = (currentState == ST_SCAN_MODE || currentState == ST_PAYMENT_UNLOCKED) ? 1000 : (currentState == ST_PAY_PIN ? 5000 : 0);
  if (interval == 0 || now - lastPollAt < interval) return;
  lastPollAt = now;
  int s = syncCartState();
  if (s == -1) { resetAllState(); currentState = ST_IDLE; stateEnteredAt = now; showIdle(); return; }
  bool nowDocked = (s == 1);
  if (paymentStatus == "pending" && lastKnownDocked && !nowDocked) { lastKnownDocked = nowDocked; triggerAntiTheft(); return; }
  lastKnownDocked = nowDocked;
  if (nowDocked && totalCents > 0 && isManualMode && paymentStatus != "pending") confirmPayment();
  if (currentState == ST_SCAN_MODE && nowDocked && totalCents > 0 && paymentStatus == "pending") { beepSuccess(); digitalWrite(RED_LED, HIGH); currentState = ST_PAYMENT_UNLOCKED; stateEnteredAt = now; typed = ""; showPaymentUnlocked(); return; }
  if (currentState == ST_SCAN_MODE) showScanMode();
}

void loop() {
  char key = getCustomKey();
  unsigned long now = millis();
  if (errorMessage.length() > 0 && (now - errorShownAt) > 3000) { errorMessage = ""; if (currentState == ST_SCAN_MODE) showScanMode(); }
  if (currentState == ST_ALARM || currentState == ST_ALARM_PIN) updateAlarmBuzzer();

  if (currentState == ST_IDLE) { if (key) { beep(); resetAllState(); currentState = ST_PHONE_ENTRY; stateEnteredAt = now; showPhoneEntry(); } globalPoll(); return; }
  
  if (currentState == ST_PHONE_ENTRY) {
    if (key) {
      beep();
      if (key == '*') typed = "";
      else if (key == '#') { if (typed.length() >= 10) { phoneNumber = typed; currentState = ST_LOOKING_UP; stateEnteredAt = now; tftClear(); tftHeader("Looking up...", ""); globalPoll(); return; } }
      else { if (typed.length() < 10) typed += key; }
      showPhoneEntry();
    } globalPoll(); return;
  }
  
  if (currentState == ST_LOOKING_UP) {
    String name, id;
    if (lookupCustomer(phoneNumber, name, id)) { customerName = name; customerId = id; beepSuccess(); currentState = ST_WELCOME; stateEnteredAt = now; showWelcome(); }
    else { beepError(); currentState = ST_NOT_REGISTERED; stateEnteredAt = now; showNotRegistered(); }
    globalPoll(); return;
  }
  
  if (currentState == ST_NOT_REGISTERED) { if (now - stateEnteredAt > 5000) { typed = ""; currentState = ST_PHONE_ENTRY; stateEnteredAt = now; showPhoneEntry(); } globalPoll(); return; }
  if (currentState == ST_WELCOME) { if (key == '#') { beep(); currentState = ST_MODE_MENU; stateEnteredAt = now; showModeMenu(); } globalPoll(); return; }
  
  if (currentState == ST_MODE_MENU) {
    if (key == '1') { beep(); isManualMode = false; currentState = ST_WEBSITE_QR; stateEnteredAt = now; lastPollAt = 0; showQR(); }
    else if (key == '2') { beep(); isManualMode = true; typed = ""; currentState = ST_MANUAL_PIN; stateEnteredAt = now; showPinEntry("Enter PIN"); }
    globalPoll(); return;
  }
  
  if (currentState == ST_WEBSITE_QR) { if (now - lastPollAt > 1500) { lastPollAt = now; int s = syncCartState(); if (s == 1 || s == 0) { beepSuccess(); sawActiveSession = true; lastKnownDocked = (s == 1); currentState = ST_SCAN_MODE; stateEnteredAt = now; showScanMode(); } } globalPoll(); return; }
  
  if (currentState == ST_MANUAL_PIN) {
    if (key) {
      beep();
      if (key == '*') typed = "";
      else if (key == '#') {
        if (typed.length() >= 4) {
          tftClear(); tftHeader("Signing in...", "");
          if (login(phoneNumber, typed)) {
            tftHeader("Pairing cart...", "");
            if (pairCart()) { beepSuccess(); syncCartState(); typed = ""; sawActiveSession = true; lastKnownDocked = cartIsDocked; currentState = ST_SCAN_MODE; stateEnteredAt = now; lastPollAt = 0; showScanMode(); globalPoll(); return; }
            else { beepError(); errorMessage = "Pairing failed"; errorShownAt = now; showPinEntry("Enter PIN"); tftError(errorMessage.c_str()); delay(1800); typed = ""; currentState = ST_MODE_MENU; stateEnteredAt = now; errorMessage = ""; showModeMenu(); globalPoll(); return; }
          } else { beepError(); if (errorMessage.length() == 0) errorMessage = "Wrong PIN"; errorShownAt = now; showPinEntry("Enter PIN"); tftError(errorMessage.c_str()); delay(1800); typed = ""; currentState = ST_MANUAL_PIN; stateEnteredAt = now; errorMessage = ""; showPinEntry("Enter PIN"); globalPoll(); return; }
        }
      } else { if (typed.length() < 6) typed += key; }
      showPinEntry("Enter PIN");
    } globalPoll(); return;
  }
  
  if (currentState == ST_SCAN_MODE) {
    if (key) { if (key == '#') { beep(); currentState = ST_CONFIRM_CANCEL; stateEnteredAt = now; showConfirmCancel(); globalPoll(); return; } lastPollAt = now; globalPoll(); return; }
    
    //if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      String uid = ""; for (byte i = 0; i < rfid.uid.size; i++) { if (rfid.uid.uidByte[i] < 0x10) uid += "0"; uid += String(rfid.uid.uidByte[i], HEX); }
      uid.toUpperCase(); rfid.PICC_HaltA();
      if (cartIsDocked) { beepError(); errorShownAt = now; showScanMode(); tftError("Cart docked - cannot scan"); globalPoll(); return; }
      if (uid != lastUID || (now - lastUIDAt > 2000)) {
        lastUID = uid; lastUIDAt = now;
        if (scanItem(uid)) { beepSuccess(); showScanMode(); }
        else { beepError(); errorShownAt = now; showScanMode(); tftError(errorMessage.length() ? errorMessage.c_str() : "Scan failed"); }
      }
    }
    globalPoll(); return;
  }
  
  if (currentState == ST_CONFIRM_CANCEL) {
    if (key) {
      beep();
      if (key == '#') { tftClear(); tftHeader("Clearing cart...", ""); resetCart(); resetAllState(); currentState = ST_IDLE; stateEnteredAt = now; showIdle(); globalPoll(); return; }
      else if (key == '*') { currentState = ST_SCAN_MODE; stateEnteredAt = now; lastPollAt = now; showScanMode(); }
    }
    globalPoll(); return;
  }
  
  if (currentState == ST_PAYMENT_UNLOCKED) {
    if (isManualMode && (now - stateEnteredAt > 1500)) { typed = ""; currentState = ST_PAY_PIN; stateEnteredAt = now; showPinEntry("Pay PIN"); globalPoll(); return; }
    if (key == '#') { beep(); typed = ""; currentState = ST_PAY_PIN; stateEnteredAt = now; showPinEntry("Pay PIN"); globalPoll(); return; }
    globalPoll(); return;
  }
  
  if (currentState == ST_PAY_PIN) {
    if (key) {
      beep();
      if (key == '*') { typed = ""; showPinEntry("Pay PIN"); globalPoll(); return; }
      if (key == '0' && typed.length() == 0) { typed = ""; currentState = ST_PAYMENT_UNLOCKED; stateEnteredAt = now; lastPollAt = now; showPaymentUnlocked(); globalPoll(); return; }
      if (key == '#') {
        if (typed.length() >= 4) {
          tftClear(); tftHeader("Paying...", "");
          String result = walletPayWithLogin(typed); typed = "";
          if (result == "ok") { beepSuccess(); currentState = ST_PAYMENT_DONE; stateEnteredAt = now; showPaymentDone(true, "Wallet debited"); digitalWrite(RED_LED, LOW); globalPoll(); return; }
          else if (result == "wrongpin") { beepError(); errorMessage = "Wrong PIN"; errorShownAt = now; showPinEntry("Pay PIN"); tftError(errorMessage.c_str()); delay(2000); errorMessage = ""; showPinEntry("Pay PIN"); globalPoll(); return; }
          else { beepError(); if (errorMessage.length() == 0) errorMessage = "Payment failed"; errorShownAt = now; showPinEntry("Pay PIN"); tftError(errorMessage.c_str()); delay(2000); errorMessage = ""; showPinEntry("Pay PIN"); globalPoll(); return; }
        }
        globalPoll(); return;
      }
      if (typed.length() < 6) typed += key; showPinEntry("Pay PIN");
    }
    globalPoll(); return;
  }
  
  if (currentState == ST_PAYMENT_DONE) {
    if (now - stateEnteredAt > 6000) { resetAllState(); currentState = ST_IDLE; stateEnteredAt = now; showIdle(); }
    globalPoll(); return;
  }
  
  if (currentState == ST_ALARM) {
    if (key == '0') { beep(); typed = ""; currentState = ST_ALARM_PIN; stateEnteredAt = now; showStaffPinEntry(); globalPoll(); return; }
    globalPoll(); return;
  }
  
  if (currentState == ST_ALARM_PIN) {
    if (key) {
      beep();
      if (key == '*') { typed = ""; showStaffPinEntry(); globalPoll(); return; }
      if (key == '#') {
        if (typed.length() >= 4) {
          tftClear(); tftHeader("Verifying...", "");
          if (verifyStaffPin(typed)) { noTone(BUZZER_PIN); buzzerOn = false; typed = ""; currentState = ST_ALARM_CHOICE; stateEnteredAt = now; beepSuccess(); showStaffChoice(); globalPoll(); return; }
          else { beepError(); typed = ""; showStaffPinEntry(); tftError("Wrong staff PIN"); delay(1500); showStaffPinEntry(); globalPoll(); return; }
        }
        globalPoll(); return;
      }
      if (typed.length() < 6) typed += key; showStaffPinEntry();
    }
    globalPoll(); return;
  }
  
  if (currentState == ST_ALARM_CHOICE) {
    if (key == '1') {
      beep(); clearAntiTheft("continue"); syncCartState(); typed = ""; currentState = ST_SCAN_MODE;
      stateEnteredAt = now; lastPollAt = 0; lastKnownDocked = false; showScanMode(); globalPoll(); return;
    } else if (key == '2') {
      beep(); clearAntiTheft("cancel"); resetAllState(); currentState = ST_IDLE; stateEnteredAt = now; showIdle(); globalPoll(); return;
    }
    globalPoll(); return;
  }

  globalPoll();
}