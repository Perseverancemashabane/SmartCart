const byte ROWS = 4;
const byte COLS = 3;
char keys[ROWS][COLS] = {
  {'1','2','3'},
  {'4','5','6'},
  {'7','8','9'},
  {'*','0','#'}
};

// Updated wiring (Col 3 moved to GPIO 22)
byte rowPins[ROWS] = {4, 16, 17, 21};
byte colPins[COLS] = {32, 33, 22};

char lastKey = 0;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Keypad Test (Col 3 on GPIO 22) ===");
  
  for (int i = 0; i < ROWS; i++) {
    pinMode(rowPins[i], OUTPUT);
    digitalWrite(rowPins[i], HIGH);
  }
  for (int i = 0; i < COLS; i++) {
    pinMode(colPins[i], INPUT_PULLUP);
  }
  
  Serial.println("Press keys");
}

char readKeypad() {
  for (int r = 0; r < ROWS; r++) {
    digitalWrite(rowPins[r], LOW);
    delay(2);
    for (int c = 0; c < COLS; c++) {
      if (digitalRead(colPins[c]) == LOW) {
        delay(20);
        if (digitalRead(colPins[c]) == LOW) {
          digitalWrite(rowPins[r], HIGH);
          return keys[r][c];
        }
      }
    }
    digitalWrite(rowPins[r], HIGH);
    delay(1);
  }
  return 0;
}

void loop() {
  char key = readKeypad();
  
  if (key != 0 && key != lastKey) {
    Serial.print("Key: ");
    Serial.println(key);
    lastKey = key;
  } else if (key == 0) {
    lastKey = 0;
  }
  
  delay(50);
}