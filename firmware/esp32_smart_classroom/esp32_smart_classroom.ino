/**
 * ==============================================================================
 * SMART CLASSROOM AUTOMATION SYSTEM - DUAL ZONE CONTROLLER
 * Project: NBA Smart Classroom App (NBA_SCR_App)
 * Target: ESP32 Development Board (ESP32-WROOM-32)
 *
 * Capabilities:
 * - Controls 2 Classrooms (A101 & A102) + Corridor zones from a single ESP32
 * - Non-blocking sensor polling (DHT11, Dual PIR with hold timer, Dual LDRs)
 * - 6-Channel Relay Control with Active-LOW/HIGH support
 * - Dual Servo Curtain drive with smooth non-blocking sweep & jitter prevention
 * - I2C 128x64 OLED Live Telemetry Monitor
 * - Dual-layer REST API (Legacy backward-compatible + Enhanced App JSON)
 * - Embedded Mobile-Responsive Dark Web Dashboard for instant browser testing
 * - mDNS responder (http://esp32-classroom.local) & Wi-Fi auto-reconnect
 * ==============================================================================
 */

#include "soc/rtc_cntl_reg.h"
#include "soc/soc.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <DNSServer.h>
#include <ESP32Servo.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h>
#include <Wire.h>
#include <time.h>
#include <sys/time.h>

#include "config.h"

// ==========================================
// --- HARDWARE INSTANCES ---
// ==========================================
WebServer server(WEB_SERVER_PORT);
DNSServer dnsServer;
const byte DNS_PORT = 53;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET_PIN);
Adafruit_NeoPixel strip(WS2812_NUM_LEDS, WS2812_PIN, NEO_GRB + NEO_KHZ800);

// --- Secondary Hardware I2C Bus (Wire1) for Classroom Notice Board OLED ---
// Uses GPIO 13 (SDA) and GPIO 15 (SCL) - No soldering or SMD cutting needed!
TwoWire I2C_Notice = TwoWire(1);
Adafruit_SSD1306 displayNotice(SCREEN_WIDTH, SCREEN_HEIGHT, &I2C_Notice, OLED_RESET_PIN);
bool noticeOledFound = false;

// --- Classroom Digital Notice Board State & Carousel ---
struct NoticeItemFirmware {
  String id;
  String classroomId; // "all", "cls-a101", "cls-a102"
  String title;
  String message;
  String duration;    // "1h", "24h", "never"
  unsigned long createdAtMs;
  unsigned long durationMs; // 3600000 for 1h, 86400000 for 24h, 0 for never
  bool active;
};

#define MAX_FIRMWARE_NOTICES 10
NoticeItemFirmware notices[MAX_FIRMWARE_NOTICES];
int noticeCount = 0;
int currentNoticeDisplayIndex = 0;
unsigned long lastNoticeRotationMs = 0;
unsigned long noticeActiveStartTimeMs = 0;
int lastNoticeShownIndex = -1;
volatile unsigned long newNoticePopupUntilMs = 0;
volatile int activeNoticePopupIndex = 0;
volatile int singleOledNoticeIdx = 0;

DHT dht(DHTPIN, DHTTYPE);
Servo curtain1;
Servo curtain2;
Preferences preferences;

// FreeRTOS Mutexes & Spinlocks for Thread-Safe Dual-Core Execution
SemaphoreHandle_t noticeMutex = NULL;
SemaphoreHandle_t nvsMutex = NULL;
portMUX_TYPE syncMaskMux = portMUX_INITIALIZER_UNLOCKED;

inline bool lockNotices(TickType_t ticks = pdMS_TO_TICKS(150)) {
  return noticeMutex ? (xSemaphoreTake(noticeMutex, ticks) == pdTRUE) : true;
}
inline void unlockNotices() {
  if (noticeMutex) xSemaphoreGive(noticeMutex);
}

inline bool lockNVS(TickType_t ticks = pdMS_TO_TICKS(200)) {
  return nvsMutex ? (xSemaphoreTake(nvsMutex, ticks) == pdTRUE) : true;
}
inline void unlockNVS() {
  if (nvsMutex) xSemaphoreGive(nvsMutex);
}

// ==========================================
// --- MUSICAL NOTES & PIEZO AUDIO DRIVER ---
// ==========================================
#define NOTE_F4  349
#define NOTE_G4  392
#define NOTE_A4  440
#define NOTE_AS4 466
#define NOTE_B4  494
#define NOTE_C5  523
#define NOTE_CS5 554
#define NOTE_D5  587
#define NOTE_DS5 622
#define NOTE_E5  659
#define NOTE_F5  698
#define NOTE_FS5 740
#define NOTE_G5  784
#define NOTE_GS5 831
#define NOTE_A5  880
#define NOTE_AS5 932
#define NOTE_B5  988
#define NOTE_C6  1047
#define NOTE_D6  1175
#define NOTE_E6  1319
#define NOTE_F6  1397
#define NOTE_G6  1568
#define NOTE_A6  1760
#define NOTE_B6  1976
#define REST     0

// struct BuzzerNote declared in config.h

#define MAX_CHIME_NOTES 48
BuzzerNote chimeNotes[MAX_CHIME_NOTES];
int chimeNoteCount = 0;
int chimeNoteIndex = -1;
unsigned long nextChimeNoteMs = 0;

void setBuzzerFrequency(uint16_t freqHz) {
  if (freqHz == 0) {
    #if BUZZER_IS_ACTIVE
      digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? LOW : HIGH);
    #else
      noTone(BUZZER_PIN);
      digitalWrite(BUZZER_PIN, LOW);
    #endif
  } else {
    #if BUZZER_IS_ACTIVE
      digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? HIGH : LOW);
    #else
      tone(BUZZER_PIN, freqHz);
    #endif
  }
}

void silenceBuzzer() {
  #if BUZZER_IS_ACTIVE
    digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? LOW : HIGH);
  #else
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
  #endif
}

inline void buzzerSoundOn() {
  setBuzzerFrequency(BUZZER_TONE_FREQ);
}

inline void buzzerSoundOff() {
  silenceBuzzer();
}

void queueChimeNotes(const BuzzerNote notes[], int count) {
  if (count <= 0) return;
  if (count > MAX_CHIME_NOTES) count = MAX_CHIME_NOTES;

  for (int i = 0; i < count; i++) {
    chimeNotes[i] = notes[i];
  }
  chimeNoteCount = count;
  chimeNoteIndex = 0;
  setBuzzerFrequency(chimeNotes[0].freqHz);
  nextChimeNoteMs = millis() + chimeNotes[0].durationMs;
}

void playBootChime() {
  // Gentle startup arpeggio (C5 -> E5 -> G5 -> C6)
  // Played synchronously during setup so the first note never gets stretched by subsequent network/SSL operations
  const BuzzerNote melody[] = {
    { NOTE_C5, 90 },
    { NOTE_E5, 90 },
    { NOTE_G5, 110 },
    { NOTE_C6, 250 }
  };
  for (size_t i = 0; i < sizeof(melody) / sizeof(melody[0]); i++) {
    setBuzzerFrequency(melody[i].freqHz);
    delay(melody[i].durationMs);
  }
  silenceBuzzer();
  Serial.println(F("[BUZZER] Boot startup chime played"));
}

void triggerNoticeBeep() {
  // Lively Marimba Alert Chime (E6 -> G6 -> C6)
  const BuzzerNote melody[] = {
    { NOTE_E6, 100 }, { REST, 40 },
    { NOTE_G6, 120 }, { REST, 40 },
    { NOTE_C6, 250 }
  };
  queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  Serial.println(F("[BUZZER] Notice announcement chime triggered"));
}

unsigned long lastLocalBellTriggerMs = 0;
String lastExecutedBellTs = "";
bool bellBootLatch = false;

void playBellPattern(const char* pattern) {
  unsigned long now = millis();
  if (chimeNoteIndex >= 0 && (now - lastLocalBellTriggerMs < 4000)) {
    Serial.printf("[BUZZER] Duplicate chime trigger suppressed (active note %d/%d, %lu ms ago)\n",
                  chimeNoteIndex, chimeNoteCount, now - lastLocalBellTriggerMs);
    return;
  }
  lastLocalBellTriggerMs = now;
  String p = String(pattern);
  p.toLowerCase();

  if (p == "westminster" || p == "japanese-school-bell" || p == "japanese" || p == "kin-kon-kan-kon") {
    // Westminster chime (Full 16-Note Big Ben Quarters in F Major)
    const BuzzerNote melody[] = {
      // Phrase 1 (Quarter 1)
      { NOTE_F5, 520 }, { REST, 40 },
      { NOTE_A5, 520 }, { REST, 40 },
      { NOTE_G5, 520 }, { REST, 40 },
      { NOTE_C5, 880 }, { REST, 400 },
      // Phrase 2 (Quarter 2)
      { NOTE_F5, 520 }, { REST, 40 },
      { NOTE_G5, 520 }, { REST, 40 },
      { NOTE_A5, 520 }, { REST, 40 },
      { NOTE_F5, 980 }, { REST, 500 },
      // Phrase 3 (Quarter 3)
      { NOTE_A5, 520 }, { REST, 40 },
      { NOTE_F5, 520 }, { REST, 40 },
      { NOTE_G5, 520 }, { REST, 40 },
      { NOTE_C5, 880 }, { REST, 400 },
      // Phrase 4 (Quarter 4 Hour Cadence)
      { NOTE_C5, 520 }, { REST, 40 },
      { NOTE_G5, 520 }, { REST, 40 },
      { NOTE_A5, 520 }, { REST, 40 },
      { NOTE_F5, 1200 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "triple-chime") {
    // Gentle 3-Note Harmonic Break Chime
    const BuzzerNote melody[] = {
      { NOTE_C5, 280 }, { REST, 70 },
      { NOTE_E5, 280 }, { REST, 70 },
      { NOTE_G5, 550 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "lunch-fanfare") {
    // Joyful 6-Note Lunch Chime
    const BuzzerNote melody[] = {
      { NOTE_C5, 180 }, { NOTE_E5, 180 }, { NOTE_G5, 180 },
      { NOTE_C6, 260 }, { NOTE_G5, 180 }, { NOTE_C6, 480 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "dismissal-chime") {
    // Celebratory 7-Note Scale
    const BuzzerNote melody[] = {
      { NOTE_C5, 150 }, { NOTE_D5, 150 }, { NOTE_E5, 150 },
      { NOTE_F5, 150 }, { NOTE_G5, 150 }, { NOTE_A5, 150 }, { NOTE_C6, 600 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "ding-dong") {
    // Warm 2-Tone Transition
    const BuzzerNote melody[] = {
      { NOTE_G5, 300 }, { REST, 80 },
      { NOTE_E5, 500 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "marimba-cascade") {
    // 5-Note Flowing Chime (C6 -> A5 -> G5 -> E5 -> C5)
    const BuzzerNote melody[] = {
      { NOTE_C6, 120 }, { NOTE_A5, 120 }, { NOTE_G5, 120 },
      { NOTE_E5, 120 }, { NOTE_C5, 400 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "st-michael") {
    // Historic St. Michael's Chime (Full 16-Note Cathedral Melody in F Major)
    // Phrase 1 (Descending Scale: 8-7-6-5-4-3-2-1)
    // Phrase 2 (Melodic Resolution: 8-2-3-4-7-5-6-1)
    const BuzzerNote melody[] = {
      // Phrase 1
      { NOTE_F5, 320 }, { REST, 40 },
      { NOTE_E5, 320 }, { REST, 40 },
      { NOTE_D5, 320 }, { REST, 40 },
      { NOTE_C5, 320 }, { REST, 40 },
      { NOTE_AS4, 320 }, { REST, 40 },
      { NOTE_A4, 320 }, { REST, 40 },
      { NOTE_G4, 320 }, { REST, 40 },
      { NOTE_F4, 750 }, { REST, 350 },
      // Phrase 2
      { NOTE_F5, 320 }, { REST, 40 },
      { NOTE_G4, 320 }, { REST, 40 },
      { NOTE_A4, 320 }, { REST, 40 },
      { NOTE_AS4, 320 }, { REST, 40 },
      { NOTE_E5, 320 }, { REST, 40 },
      { NOTE_C5, 320 }, { REST, 40 },
      { NOTE_D5, 320 }, { REST, 40 },
      { NOTE_F4, 1000 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "digital-synth") {
    // Future Synth Chime: 5-Note Rising Arpeggio (C5 -> G5 -> C6 -> E6 -> G6)
    const BuzzerNote melody[] = {
      { NOTE_C5, 100 }, { NOTE_G5, 100 }, { NOTE_C6, 100 },
      { NOTE_E6, 100 }, { NOTE_G6, 350 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "morning-reveille") {
    // 5-Note Motivating Assembly Fanfare (C5 -> G4 -> C5 -> E5 -> G5)
    const BuzzerNote melody[] = {
      { NOTE_C5, 150 }, { NOTE_G4, 150 }, { NOTE_C5, 150 },
      { NOTE_E5, 150 }, { NOTE_G5, 450 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "gentle-wind") {
    // 5-Note Relaxing Pentatonic Breeze (D5 -> E5 -> G5 -> A5 -> D6)
    const BuzzerNote melody[] = {
      { NOTE_D5, 200 }, { NOTE_E5, 200 }, { NOTE_G5, 200 },
      { NOTE_A5, 200 }, { NOTE_D6, 500 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "double-beep") {
    // Crisp Dual Tone
    const BuzzerNote melody[] = {
      { NOTE_A5, 180 }, { REST, 80 },
      { NOTE_E6, 350 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else if (p == "single-long") {
    // Sustained 1.5s Bell
    const BuzzerNote melody[] = {
      { NOTE_A5, 1500 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  } else {
    // Default "college-bell": 3 Ascending Academic Rings
    const BuzzerNote melody[] = {
      { NOTE_E5, 450 }, { REST, 150 },
      { NOTE_GS5, 450 }, { REST, 150 },
      { NOTE_B5, 900 }
    };
    queueChimeNotes(melody, sizeof(melody) / sizeof(melody[0]));
  }
  Serial.printf("[BUZZER] Playing musical chime pattern: '%s' (%d notes)\n", pattern, chimeNoteCount);
}

void handleBuzzer() {
  if (chimeNoteIndex < 0 || chimeNoteIndex >= chimeNoteCount) return;

  unsigned long now = millis();
  if (now >= nextChimeNoteMs) {
    chimeNoteIndex++;
    if (chimeNoteIndex < chimeNoteCount) {
      setBuzzerFrequency(chimeNotes[chimeNoteIndex].freqHz);
      nextChimeNoteMs = now + chimeNotes[chimeNoteIndex].durationMs;
    } else {
      silenceBuzzer();
      chimeNoteIndex = -1;
      chimeNoteCount = 0;
    }
  }
}

// ==========================================
// --- TIMETABLE & PERIOD BELL STATE ---
// ==========================================
struct TimetablePeriodFirmware {
  char id[16];
  char name[32];
  int startHour;
  int startMin;
  int endHour;
  int endMin;
  char type[12]; // "class", "break", "lunch", "lab"
  bool enabled;
  char pattern[32];
  uint8_t days; // Bitmask of active days (bit 0=Sun, 1=Mon..6=Sat). 0 = all active days
};

#define MAX_TIMETABLE_PERIODS 24
TimetablePeriodFirmware timetablePeriods[MAX_TIMETABLE_PERIODS];
int timetablePeriodCount = 0;
bool timetableEnabled = true;
uint8_t timetableActiveDays = 0b00111110; // Bits 1..5 (Mon..Fri)
char timetableDefaultPattern[32] = "college-bell";

int lastBellRungHour = -1;
int lastBellRungMin = -1;
char lastBellRungPeriodName[32] = "";
volatile unsigned long periodOverAlertUntilMs = 0;

void loadDefaultTimetable() {
  timetableEnabled = true;
  timetableActiveDays = 0b00111110;
  strcpy(timetableDefaultPattern, "college-bell");
  timetablePeriodCount = 8;

  const char* ids[] = {"p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"};
  const char* names[] = {
    "Period 1: Mathematics",
    "Period 2: Data Structures",
    "Morning Tea Break",
    "Period 3: Networks",
    "Lunch Break",
    "Period 4: IoT & Embedded",
    "Period 5: Database Sys",
    "Period 6: Lab Work"
  };
  int sH[] = {9, 10, 11, 11, 12, 13, 14, 15};
  int sM[] = {0, 0, 0, 15, 15, 15, 15, 15};
  int eH[] = {10, 11, 11, 12, 13, 14, 15, 16};
  int eM[] = {0, 0, 15, 15, 15, 15, 15, 15};
  const char* types[] = {"class", "class", "break", "class", "lunch", "class", "class", "lab"};
  const char* pats[] = {"westminster", "college-bell", "triple-chime", "college-bell", "st-michael", "college-bell", "college-bell", "dismissal-chime"};

  for (int i = 0; i < 8; i++) {
    strncpy(timetablePeriods[i].id, ids[i], sizeof(timetablePeriods[i].id) - 1);
    timetablePeriods[i].id[sizeof(timetablePeriods[i].id) - 1] = '\0';
    strncpy(timetablePeriods[i].name, names[i], sizeof(timetablePeriods[i].name) - 1);
    timetablePeriods[i].name[sizeof(timetablePeriods[i].name) - 1] = '\0';
    timetablePeriods[i].startHour = sH[i];
    timetablePeriods[i].startMin = sM[i];
    timetablePeriods[i].endHour = eH[i];
    timetablePeriods[i].endMin = eM[i];
    strncpy(timetablePeriods[i].type, types[i], sizeof(timetablePeriods[i].type) - 1);
    timetablePeriods[i].type[sizeof(timetablePeriods[i].type) - 1] = '\0';
    timetablePeriods[i].enabled = true;
    strncpy(timetablePeriods[i].pattern, pats[i], sizeof(timetablePeriods[i].pattern) - 1);
    timetablePeriods[i].pattern[sizeof(timetablePeriods[i].pattern) - 1] = '\0';
    timetablePeriods[i].days = 0;
  }
}

bool parseTimetableJson(const String& jsonStr) {
  StaticJsonDocument<4096> doc;
  DeserializationError err = deserializeJson(doc, jsonStr);
  if (err) {
    Serial.printf("[TIMETABLE] JSON deserialize failed: %s\n", err.c_str());
    return false;
  }

  if (doc.containsKey("enabled")) {
    timetableEnabled = doc["enabled"].as<bool>();
  }
  if (doc.containsKey("defaultPattern")) {
    const char* dp = doc["defaultPattern"];
    if (dp && strlen(dp) > 0) {
      strncpy(timetableDefaultPattern, dp, sizeof(timetableDefaultPattern) - 1);
      timetableDefaultPattern[sizeof(timetableDefaultPattern) - 1] = '\0';
    }
  }
  if (doc.containsKey("activeDays")) {
    timetableActiveDays = 0;
    JsonArray days = doc["activeDays"].as<JsonArray>();
    for (int d : days) {
      if (d >= 0 && d <= 6) {
        timetableActiveDays |= (1 << d);
      }
    }
  }

  if (doc.containsKey("periods")) {
    JsonArray pArr = doc["periods"].as<JsonArray>();
    timetablePeriodCount = 0;
    for (JsonObject obj : pArr) {
      if (timetablePeriodCount >= MAX_TIMETABLE_PERIODS) break;
      TimetablePeriodFirmware &p = timetablePeriods[timetablePeriodCount];

      const char* pid = obj["id"] | "";
      const char* pname = obj["name"] | "";
      const char* ptype = obj["type"] | "class";
      const char* ppat = obj["bellPattern"] | timetableDefaultPattern;
      const char* st = obj["startTime"] | "09:00";
      const char* et = obj["endTime"] | "10:00";
      bool pen = obj.containsKey("enabled") ? obj["enabled"].as<bool>() : true;

      strncpy(p.id, pid, sizeof(p.id) - 1);
      p.id[sizeof(p.id) - 1] = '\0';
      strncpy(p.name, pname, sizeof(p.name) - 1);
      p.name[sizeof(p.name) - 1] = '\0';
      strncpy(p.type, ptype, sizeof(p.type) - 1);
      p.type[sizeof(p.type) - 1] = '\0';
      strncpy(p.pattern, ppat, sizeof(p.pattern) - 1);
      p.pattern[sizeof(p.pattern) - 1] = '\0';
      p.enabled = pen;
      p.days = 0;
      if (obj.containsKey("days")) {
        JsonArray dArr = obj["days"].as<JsonArray>();
        for (int d : dArr) {
          if (d >= 0 && d <= 6) {
            p.days |= (1 << d);
          }
        }
      }

      sscanf(st, "%d:%d", &p.startHour, &p.startMin);
      sscanf(et, "%d:%d", &p.endHour, &p.endMin);

      timetablePeriodCount++;
    }
  }

  Serial.printf("[TIMETABLE] Updated: %d periods, enabled=%d, defaultPattern=%s\n",
                timetablePeriodCount, timetableEnabled, timetableDefaultPattern);
  return true;
}

void saveTimetableToNVS(const String& jsonStr) {
  if (lockNVS()) {
    preferences.putString("tt_json", jsonStr);
    unlockNVS();
  }
}

void loadTimetableFromNVS() {
  String jsonStr = "";
  if (lockNVS()) {
    jsonStr = preferences.getString("tt_json", "");
    unlockNVS();
  }
  if (jsonStr.length() > 10) {
    if (!parseTimetableJson(jsonStr)) {
      loadDefaultTimetable();
    }
  } else {
    loadDefaultTimetable();
  }
}

void checkTimetableBell() {
  if (!timetableEnabled || timetablePeriodCount == 0) return;

  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 10)) {
    return;
  }

  static int lastCheckedMin = -1;
  int currentHour = timeinfo.tm_hour;
  int currentMin = timeinfo.tm_min;

  // Only evaluate once when the minute changes (during the first 30 seconds of the minute)
  // This prevents loop or network latency from ever skipping second 0 and missing the bell!
  if (currentMin == lastCheckedMin) return;
  if (timeinfo.tm_sec > 30) return;
  lastCheckedMin = currentMin;

  int currentDayBit = (1 << timeinfo.tm_wday);
  if (!(timetableActiveDays & currentDayBit)) {
    return;
  }

  if (currentHour == lastBellRungHour && currentMin == lastBellRungMin) {
    return;
  }

  for (int i = 0; i < timetablePeriodCount; i++) {
    if (!timetablePeriods[i].enabled) continue;
    if (timetablePeriods[i].days != 0 && !(timetablePeriods[i].days & currentDayBit)) continue;

    if (timetablePeriods[i].endHour == currentHour && timetablePeriods[i].endMin == currentMin) {
      lastBellRungHour = currentHour;
      lastBellRungMin = currentMin;
      strncpy(lastBellRungPeriodName, timetablePeriods[i].name, sizeof(lastBellRungPeriodName) - 1);
      lastBellRungPeriodName[sizeof(lastBellRungPeriodName) - 1] = '\0';
      periodOverAlertUntilMs = millis() + 10000;

      const char* pat = (strlen(timetablePeriods[i].pattern) > 0) ? timetablePeriods[i].pattern : timetableDefaultPattern;
      Serial.printf("[TIMETABLE] Period Ended: '%s' at %02d:%02d! Playing pattern: %s\n",
                    timetablePeriods[i].name, currentHour, currentMin, pat);
      playBellPattern(pat);
      break;
    }
  }
}

// ==========================================
// --- SYSTEM STATE & THRESHOLDS ---
// ==========================================
volatile bool isAutoMode = false; // Loaded from NVS in setup()
void setSystemModeInternal(bool autoMode, bool notifyCloud = true);

float currentTempThreshold = DEFAULT_TEMP_THRESHOLD;
int currentLdrThreshold = DEFAULT_LDR_THRESHOLD;
unsigned long currentHoldTime = OCCUPANCY_HOLD_MS;

// Shared Sensors
volatile float currentTemp = 24.0;
volatile float currentHum = 50.0;
volatile int ldr1_value = 0;
volatile int ldr2_value = 0;

// Classroom 1 (A101) State
volatile bool pir1_active = false;
volatile bool c1_occupied = false;
volatile unsigned long c1_last_motion = 0;
volatile bool state_c1_light = false;
volatile bool state_c1_fan = false;
volatile bool state_c1_curtain = false;
int current_c1_angle = SERVO_CLOSED_ANGLE;
int target_c1_angle = SERVO_CLOSED_ANGLE;
unsigned long last_servo1_move = 0;
bool servo1_attached = false;

// Classroom 1 (A101) AC Power Meter (ACS712 Current & ZMPT101B Voltage)
volatile float c1_voltage = 0.0;    // Vrms (Volts AC)
volatile float c1_current = 0.0;    // Irms (Amperes AC)
volatile float c1_real_power = 0.0; // P (Watts Active Load)
unsigned long lastPowerSample = 0;

// Dynamic Real Energy Accumulators (kWh & Cost)
volatile double c1_accumulated_kwh = 0.0;
volatile double c2_accumulated_kwh = 0.0;
float c1_hourly_kwh[24] = {0.0f};
unsigned long lastEnergyIntegrateMs = 0;
unsigned long lastEnergySaveNvsMs = 0;
int lastRecordedHour = -1;

// Classroom 2 (A102) State
volatile bool pir2_active = false;
volatile bool c2_occupied = false;
volatile unsigned long c2_last_motion = 0;
volatile bool state_c2_light = false;
volatile bool state_c2_fan = false;
volatile bool state_c2_curtain = false;
int current_c2_angle = SERVO_CLOSED_ANGLE;
int target_c2_angle = SERVO_CLOSED_ANGLE;
unsigned long last_servo2_move = 0;
bool servo2_attached = false;

// Corridor States
volatile bool state_corr1_light = false;
volatile bool state_corr2_light = false;

// WS2812B Addressable LED Strip State (Corridor Zone, 15 LEDs, GPIO 5)
volatile bool state_ws2812 = false;
volatile bool ws2812_needs_update = false;
String ws2812_color = WS2812_DEFAULT_COLOR;
int ws2812_brightness = WS2812_DEFAULT_BRIGHTNESS; // 0-255
String ws2812_mode = "solid";                      // "solid", "breathe", "rainbow", "strobe"
unsigned long last_ws2812_anim_ms = 0;
uint16_t ws2812_anim_step = 0;
bool ws2812_strobe_state = false;
unsigned long lastWs2812LocalChange = 0;

// Display States for Classroom 1 (A101)
volatile bool state_c1_smart_screen = true;   // Primary OLED (Telemetry Display on Wire)
volatile bool state_c1_notice_screen = true;  // Secondary OLED (Notice Board on Wire1)
volatile bool pendingNoticeBeep = false;      // Decouples Core 0 cloud sync from Core 1 audio PWM

// Cloud State Tracking (Prevents stale DB polls from overriding local sensor
// actions)
bool cloud_initialized = false;
bool cloud_prev_c1_light = false;
bool cloud_prev_c1_fan = false;
bool cloud_prev_c1_curtain = false;
bool cloud_prev_c1_smart_screen = true;
bool cloud_prev_c1_notice_board = true;
bool cloud_prev_c2_light = false;
bool cloud_prev_c2_fan = false;
bool cloud_prev_c2_curtain = false;
bool cloud_prev_corr1_light = false;
bool cloud_prev_corr2_light = false;
bool cloud_prev_ws2812 = false;
bool cloud_prev_system_auto = false;
volatile bool pendingModeCloudSync = false;
volatile bool pendingIpCloudSync = true;
unsigned long lastLocalModeChange = 0;

// ==========================================
// --- 24/7 AUTONOMOUS ONBOARD DEVICE SCHEDULING ENGINE ---
// ==========================================
// Evaluates schedule rules directly on the ESP32 hardware RTC timer.
// Fully autonomous: runs 24/7 even if phone is off, app is closed, or Wi-Fi/Internet drops!
struct FirmwareDeviceSchedule {
  const char* devCode;       // "l1", "f1", "c1", "nb", "ss", "l2", "f2", "c2", "cr1", "cr2", "rgb"
  const char* primaryId;     // App Supabase ID, e.g. "dev-a101-light-1"
  const char* nvsKey;        // NVS flash key (max 15 chars), e.g. "sc_c1_l"
  bool enabled;
  int onHour;                // 0-23, or -1 if disabled
  int onMin;                 // 0-59, or -1 if disabled
  int offHour;               // 0-23, or -1 if disabled
  int offMin;                // 0-59, or -1 if disabled
  uint8_t days;              // Bitmask: bit 0 = Sun, bit 1 = Mon, ..., bit 6 = Sat (0x7F = all days)
  bool autoOffEnabled;       // If true, automatically shuts down after autoOffMinutes of being turned ON
  int autoOffMinutes;        // Minutes to run before automatic shutdown
  unsigned long turnOnTimestampMs;
  int lastTriggeredOnDay;
  int lastTriggeredOnMin;
  int lastTriggeredOffDay;
  int lastTriggeredOffMin;
};

#define NUM_SCHEDULED_DEVICES 11
FirmwareDeviceSchedule deviceSchedules[NUM_SCHEDULED_DEVICES] = {
  { "l1",  "dev-a101-light-1",     "sc_c1_l",  false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "f1",  "dev-a101-fan-1",       "sc_c1_f",  false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "c1",  "dev-a101-curtain",     "sc_c1_c",  false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "nb",  "dev-a101-notice-board", "sc_c1_nb", false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "ss",  "dev-a101-smart-screen", "sc_c1_ss", false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "l2",  "dev-a102-light-1",     "sc_c2_l",  false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "f2",  "dev-a102-fan-1",       "sc_c2_f",  false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "c2",  "dev-a102-curtain",     "sc_c2_c",  false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "cr1", "dev-corr-light-1",     "sc_cr1",   false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "cr2", "dev-corr-light-2",     "sc_cr2",   false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 },
  { "rgb", "dev-corr-rgb-strip",   "sc_ws",    false, -1, -1, -1, -1, 0x7F, false, 0, 0, -1, -1, -1, -1 }
};

// Queue for asynchronous background cloud sync of device state changes
volatile uint16_t pendingDeviceCloudSyncMask = 0;

// Local device actuation timestamp array: shields each device against stale cloud poll echoes
unsigned long lastLocalDeviceControlMs[NUM_SCHEDULED_DEVICES] = {0};

int getDeviceScheduleIndex(const String& devId) {
  String d = devId;
  d.toLowerCase();
  if (d == "l1" || d == "light1" || d.indexOf("a101-light") >= 0) return 0;
  if (d == "f1" || d == "fan1" || d.indexOf("a101-fan") >= 0) return 1;
  if (d == "c1" || d == "curtain1" || d.indexOf("a101-curtain") >= 0) return 2;
  if (d == "nb" || d == "notice" || d.indexOf("a101-notice") >= 0) return 3;
  if (d == "ss" || d == "smart" || d.indexOf("a101-smart") >= 0 || d.indexOf("a101-screen") >= 0) return 4;
  if (d == "l2" || d == "light2" || d.indexOf("a102-light") >= 0) return 5;
  if (d == "f2" || d == "fan2" || d.indexOf("a102-fan") >= 0) return 6;
  if (d == "c2" || d == "curtain2" || d.indexOf("a102-curtain") >= 0) return 7;
  if (d == "cr1" || d == "corr1" || d.indexOf("corr-light1") >= 0 || d.indexOf("corr-light-1") >= 0) return 8;
  if (d == "cr2" || d == "corr2" || d.indexOf("corr-light2") >= 0 || d.indexOf("corr-light-2") >= 0) return 9;
  if (d == "rgb" || d == "ws2812" || d.indexOf("rgb") >= 0 || d.indexOf("strip") >= 0) return 10;
  return -1;
}

bool getDeviceCurrentState(const String& dev) {
  String d = dev;
  d.toLowerCase();
  if (d == "l1" || d == "light1" || d.indexOf("a101-light") >= 0) return state_c1_light;
  if (d == "f1" || d == "fan1" || d.indexOf("a101-fan") >= 0) return state_c1_fan;
  if (d == "c1" || d == "curtain1" || d.indexOf("a101-curtain") >= 0) return state_c1_curtain;
  if (d == "nb" || d == "notice" || d.indexOf("a101-notice") >= 0) return state_c1_notice_screen;
  if (d == "ss" || d == "smart" || d.indexOf("a101-smart") >= 0 || d.indexOf("a101-screen") >= 0) return state_c1_smart_screen;
  if (d == "l2" || d == "light2" || d.indexOf("a102-light") >= 0) return state_c2_light;
  if (d == "f2" || d == "fan2" || d.indexOf("a102-fan") >= 0) return state_c2_fan;
  if (d == "c2" || d == "curtain2" || d.indexOf("a102-curtain") >= 0) return state_c2_curtain;
  if (d == "cr1" || d == "corr1" || d.indexOf("corr-light1") >= 0 || d.indexOf("corr-light-1") >= 0) return state_corr1_light;
  if (d == "cr2" || d == "corr2" || d.indexOf("corr-light2") >= 0 || d.indexOf("corr-light-2") >= 0) return state_corr2_light;
  if (d == "rgb" || d == "ws2812" || d.indexOf("rgb-strip") >= 0) return state_ws2812;
  return false;
}

void queueDeviceCloudSync(int idx, bool isOn) {
  if (idx < 0 || idx >= NUM_SCHEDULED_DEVICES) return;
  // Update local baseline tracking variables so upcoming DB poll doesn't fight scheduled change
  if (idx == 0) cloud_prev_c1_light = isOn;
  else if (idx == 1) cloud_prev_c1_fan = isOn;
  else if (idx == 2) cloud_prev_c1_curtain = isOn;
  else if (idx == 3) cloud_prev_c1_notice_board = isOn;
  else if (idx == 4) cloud_prev_c1_smart_screen = isOn;
  else if (idx == 5) cloud_prev_c2_light = isOn;
  else if (idx == 6) cloud_prev_c2_fan = isOn;
  else if (idx == 7) cloud_prev_c2_curtain = isOn;
  else if (idx == 8) cloud_prev_corr1_light = isOn;
  else if (idx == 9) cloud_prev_corr2_light = isOn;
  else if (idx == 10) cloud_prev_ws2812 = isOn;

  portENTER_CRITICAL(&syncMaskMux);
  pendingDeviceCloudSyncMask |= (1 << idx);
  portEXIT_CRITICAL(&syncMaskMux);
}

bool parseDeviceSchedule(int idx, JsonVariantConst sObj) {
  if (idx < 0 || idx >= NUM_SCHEDULED_DEVICES) return false;
  FirmwareDeviceSchedule &sched = deviceSchedules[idx];

  sched.enabled = sObj["enabled"] | false;

  const char *onStr = sObj["onTime"] | "";
  if (strlen(onStr) >= 4 && sscanf(onStr, "%d:%d", &sched.onHour, &sched.onMin) == 2) {
    // Valid onTime parsed
  } else {
    sched.onHour = -1;
    sched.onMin = -1;
  }

  const char *offStr = sObj["offTime"] | "";
  if (strlen(offStr) >= 4 && sscanf(offStr, "%d:%d", &sched.offHour, &sched.offMin) == 2) {
    // Valid offTime parsed
  } else {
    sched.offHour = -1;
    sched.offMin = -1;
  }

  if (sObj.containsKey("days") && sObj["days"].is<JsonArrayConst>()) {
    sched.days = 0;
    for (int d : sObj["days"].as<JsonArrayConst>()) {
      if (d >= 0 && d <= 7) {
        int wday = (d == 7) ? 0 : d; // ISO 7 (Sun) maps to 0 for tm_wday
        sched.days |= (1 << wday);
      }
    }
  } else {
    sched.days = 0x7F; // Default all 7 days
  }

  sched.autoOffEnabled = sObj["autoOffEnabled"] | false;
  sched.autoOffMinutes = sObj["autoOffMinutes"] | 0;

  Serial.printf("[SCHEDULE] Configured %s (%s): en=%d, ON=%02d:%02d, OFF=%02d:%02d, days=0x%02X, autoOff=%d (%dm)\n",
                sched.devCode, sched.primaryId, sched.enabled, sched.onHour, sched.onMin, sched.offHour, sched.offMin,
                sched.days, sched.autoOffEnabled, sched.autoOffMinutes);
  return true;
}

void saveDeviceScheduleToNVS(int idx, const String& jsonStr) {
  if (idx < 0 || idx >= NUM_SCHEDULED_DEVICES) return;
  if (lockNVS()) {
    preferences.putString(deviceSchedules[idx].nvsKey, jsonStr);
    unlockNVS();
  }
}

void loadDeviceSchedulesFromNVS() {
  Serial.println(F("[SCHEDULE] Loading persistent device schedules from NVS flash..."));
  int loadedCount = 0;
  for (int i = 0; i < NUM_SCHEDULED_DEVICES; i++) {
    String stored = "";
    if (lockNVS()) {
      stored = preferences.getString(deviceSchedules[i].nvsKey, "");
      unlockNVS();
    }
    if (stored.length() > 5) {
      StaticJsonDocument<512> doc;
      DeserializationError err = deserializeJson(doc, stored);
      if (!err) {
        parseDeviceSchedule(i, doc.as<JsonVariantConst>());
        loadedCount++;
      }
    }
  }
  Serial.printf("[SCHEDULE] %d active schedules restored from flash memory.\n", loadedCount);
}

// Forward declarations
void applyDeviceControl(String dev, bool st);

void checkDeviceSchedules() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 10)) {
    return; // Hardware RTC has not yet acquired epoch from NTP or /api/time
  }

  // Evaluate exactly once per minute
  static int lastCheckedMin = -1;
  if (timeinfo.tm_min == lastCheckedMin) {
    return;
  }
  lastCheckedMin = timeinfo.tm_min;

  int currentHour = timeinfo.tm_hour;
  int currentMin = timeinfo.tm_min;
  int currentDay = timeinfo.tm_wday; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  int currentDayBit = (1 << currentDay);

  for (int i = 0; i < NUM_SCHEDULED_DEVICES; i++) {
    FirmwareDeviceSchedule &sched = deviceSchedules[i];
    if (!sched.enabled) continue;
    if (!(sched.days & currentDayBit)) continue;

    // Check Turn ON time match
    if (sched.onHour == currentHour && sched.onMin == currentMin) {
      if (sched.lastTriggeredOnDay != currentDay || sched.lastTriggeredOnMin != currentMin) {
        sched.lastTriggeredOnDay = currentDay;
        sched.lastTriggeredOnMin = currentMin;
        sched.turnOnTimestampMs = millis();
        Serial.printf("[SCHEDULE ENGINE] Triggered ON for %s (%s) at %02d:%02d\n",
                      sched.devCode, sched.primaryId, currentHour, currentMin);

        // If Auto Mode was active, disarm to Manual so motion sensors don't conflict
        if (isAutoMode) {
          setSystemModeInternal(false, true);
        }
        applyDeviceControl(sched.devCode, true);
        queueDeviceCloudSync(i, true);
      }
    }

    // Check Turn OFF time match
    if (sched.offHour == currentHour && sched.offMin == currentMin) {
      if (sched.lastTriggeredOffDay != currentDay || sched.lastTriggeredOffMin != currentMin) {
        sched.lastTriggeredOffDay = currentDay;
        sched.lastTriggeredOffMin = currentMin;
        sched.turnOnTimestampMs = 0;
        Serial.printf("[SCHEDULE ENGINE] Triggered OFF for %s (%s) at %02d:%02d\n",
                      sched.devCode, sched.primaryId, currentHour, currentMin);

        applyDeviceControl(sched.devCode, false);
        queueDeviceCloudSync(i, false);
      }
    }
  }
}

void checkAutoOffTimers() {
  unsigned long now = millis();
  for (int i = 0; i < NUM_SCHEDULED_DEVICES; i++) {
    FirmwareDeviceSchedule &sched = deviceSchedules[i];
    if (!sched.autoOffEnabled || sched.autoOffMinutes <= 0) continue;
    if (sched.turnOnTimestampMs == 0) continue;

    bool isCurrentlyOn = getDeviceCurrentState(sched.devCode);
    if (!isCurrentlyOn) {
      sched.turnOnTimestampMs = 0;
      continue;
    }

    unsigned long durationMs = (unsigned long)sched.autoOffMinutes * 60000UL;
    if (now - sched.turnOnTimestampMs >= durationMs) {
      Serial.printf("[AUTO-OFF TIMER] %s (%s) auto-off expired (%d mins). Turning OFF.\n",
                    sched.devCode, sched.primaryId, sched.autoOffMinutes);
      sched.turnOnTimestampMs = 0;
      applyDeviceControl(sched.devCode, false);
      queueDeviceCloudSync(i, false);
    }
  }
}

// OLED Hardware flag
bool oledFound = false;

void syncDisplayPowerStates() {
  static int hw_smart_screen = -1;
  static int hw_notice_screen = -1;

  int target_smart = state_c1_smart_screen ? 1 : 0;
  if (oledFound && hw_smart_screen != target_smart) {
    hw_smart_screen = target_smart;
    if (target_smart == 1) {
      display.ssd1306_command(SSD1306_DISPLAYON);
    } else {
      display.clearDisplay();
      display.display();
      display.ssd1306_command(SSD1306_DISPLAYOFF);
    }
    Serial.printf("[DISPLAY] Smart Screen (Telemetry) -> %s\n", target_smart ? "ON" : "OFF");
  }

  int target_notice = state_c1_notice_screen ? 1 : 0;
  if (noticeOledFound && hw_notice_screen != target_notice) {
    hw_notice_screen = target_notice;
    if (target_notice == 1) {
      displayNotice.ssd1306_command(SSD1306_DISPLAYON);
    } else {
      displayNotice.clearDisplay();
      displayNotice.display();
      displayNotice.ssd1306_command(SSD1306_DISPLAYOFF);
    }
    Serial.printf("[DISPLAY] Notice Board Screen -> %s\n", target_notice ? "ON" : "OFF");
  }
}

void setSmartScreenPower(bool on) {
  state_c1_smart_screen = on;
}

void setNoticeScreenPower(bool on) {
  state_c1_notice_screen = on;
}

// Dynamic Wi-Fi Provisioning & AP Setup Mode flags
bool isApSetupMode = false;
String configured_ssid = "";
String configured_pass = "";

// ==========================================
// ==========================================
// --- CLASSROOM A101 AC POWER METER SAMPLING ---
// ==========================================
// Samples ACS712 Current & ZMPT101B Voltage over a 40ms window
// (Exactly two 50Hz AC cycles or 2.4 60Hz cycles)
void sampleA101PowerMeter() {
  unsigned long now = millis();
  if (now - lastPowerSample < POWER_METER_SAMPLE_MS) {
    return;
  }
  lastPowerSample = now;

  // Collect 160 evenly spaced samples over 40ms (250us interval)
  const int NUM_SAMPLES = 160;
  static int rawV[NUM_SAMPLES];
  static int rawI[NUM_SAMPLES];
  long sumRawV = 0;
  long sumRawI = 0;

  for (int i = 0; i < NUM_SAMPLES; i++) {
    rawV[i] = analogRead(ZMPT101B_VOLTAGE_PIN);
    rawI[i] = analogRead(ACS712_CURRENT_PIN);
    sumRawV += rawV[i];
    sumRawI += rawI[i];
    delayMicroseconds(250);
  }

  // Dynamic DC bias midpoint (ACS712 & ZMPT101B naturally center around Vcc/2)
  float midV = (float)sumRawV / NUM_SAMPLES;
  float midI = (float)sumRawI / NUM_SAMPLES;

  // Calculate RMS deviation from DC midpoint
  double sumSqV = 0.0;
  double sumSqI = 0.0;
  for (int i = 0; i < NUM_SAMPLES; i++) {
    float diffV = (float)rawV[i] - midV;
    float diffI = (float)rawI[i] - midI;
    sumSqV += (diffV * diffV);
    sumSqI += (diffI * diffI);
  }

  // Convert ADC counts to RMS Volts at ESP32 pin (3.3V reference on 12-bit ADC)
  float vAdcRms = sqrt(sumSqV / NUM_SAMPLES) * (3.3f / 4095.0f);
  float iAdcRms = sqrt(sumSqI / NUM_SAMPLES) * (3.3f / 4095.0f);

  // Scaled physical values
  float vRms = vAdcRms * ZMPT101B_CALIBRATION;
  float iRms = iAdcRms / ACS712_SENSITIVITY;

  // Robust noise gate:
  // Mains AC is ~230V. Any reading under 60V on an open input is ambient
  // electromagnetic pickup (50Hz antenna effect on high-gain ZMPT101B op-amp).
  if (vRms < 60.0f) {
    vRms = 0.0f;
  }

  // Hall-effect sensor ACS712 has inherent thermal/switching noise (~21mV
  // pk-pk). Readout below 0.09A is quiescent baseline noise.
  if (iRms < 0.09f) {
    iRms = 0.0f;
  }

  // If NO AC Mains line is connected (no voltage detected), there cannot be
  // real AC current or active power. Force clean zero.
  if (vRms < 60.0f) {
    c1_voltage = 0.0f;
    c1_current = 0.0f;
    c1_real_power = 0.0f;
    return;
  }

  c1_voltage = vRms;
  c1_current = iRms;

  // Calculate Real Power (Watts): P = Vrms * Irms * PowerFactor
  if (c1_voltage >= 60.0f && c1_current >= 0.09f) {
    c1_real_power = c1_voltage * c1_current * POWER_FACTOR_A101;
  } else {
    c1_real_power = 0.0f;
  }
}

// ==========================================
// --- POWER TELEMETRY HELPERS ---
// ==========================================
float rated_c1_light = WATTS_CLASS_LIGHT;
float rated_c1_fan = WATTS_CLASS_FAN;
float rated_c2_light = WATTS_CLASS_LIGHT;
float rated_c2_fan = WATTS_CLASS_FAN;
float rated_corr1 = WATTS_CORR_LIGHT;
float rated_corr2 = WATTS_CORR_LIGHT;
float rated_ws2812 = WATTS_WS2812_STRIP;

float getC1LoadWatts() {
  // If physical ACS712/ZMPT101B detects real active power, use measured value
  if (c1_real_power > 0.5f) {
    return c1_real_power;
  }
  // Otherwise fallback to rated relay load
  float w = 0.0;
  if (state_c1_light)
    w += rated_c1_light;
  if (state_c1_fan)
    w += rated_c1_fan;
  if (state_c1_curtain)
    w += WATTS_SERVO_ACTIVE;
  return w;
}

float getC2LoadWatts() {
  float w = 0.0;
  if (state_c2_light)
    w += rated_c2_light;
  if (state_c2_fan)
    w += rated_c2_fan;
  if (state_c2_curtain)
    w += WATTS_SERVO_ACTIVE;
  return w;
}

float getTotalLoadWatts() {
  float w = getC1LoadWatts() + getC2LoadWatts();
  if (state_corr1_light)
    w += rated_corr1;
  if (state_corr2_light)
    w += rated_corr2;
  if (state_ws2812)
    w += (rated_ws2812 * (ws2812_brightness / 255.0f));
  return w;
}

float getCorrLoadWatts() {
  float w = 0.0;
  if (state_corr1_light)
    w += rated_corr1;
  if (state_corr2_light)
    w += rated_corr2;
  if (state_ws2812)
    w += (rated_ws2812 * (ws2812_brightness / 255.0f));
  return w;
}

// ==========================================
// --- REAL-TIME ENERGY INTEGRATION (kWh) ---
// ==========================================
// Integrates real active power over time: kWh = (Watts * dt_hours) / 1000
void integrateRealEnergy() {
  unsigned long now = millis();
  if (lastEnergyIntegrateMs == 0) {
    lastEnergyIntegrateMs = now;
    return;
  }

  unsigned long elapsedMs = now - lastEnergyIntegrateMs;
  if (elapsedMs < 1000) {
    return; // Integrate every ~1.0 second
  }
  lastEnergyIntegrateMs = now;

  double dtHours = (double)elapsedMs / 3600000.0;

  // Classroom 1: Real measured watts (from ACS712 & ZMPT101B when active)
  float w1 = getC1LoadWatts();
  double deltaKwh1 = ((double)w1 / 1000.0) * dtHours;
  c1_accumulated_kwh += deltaKwh1;

  // Classroom 2: Relay-based load
  float w2 = getC2LoadWatts();
  double deltaKwh2 = ((double)w2 / 1000.0) * dtHours;
  c2_accumulated_kwh += deltaKwh2;

  // Track hourly consumption bucket
  struct tm timeinfo;
  int currentHour = (now / 3600000) % 24; // Default fallback to uptime hours
  if (getLocalTime(&timeinfo, 20)) {
    currentHour = timeinfo.tm_hour;
    // Auto-reset daily energy at midnight (00:00)
    if (lastRecordedHour == 23 && currentHour == 0) {
      c1_accumulated_kwh = 0.0;
      c2_accumulated_kwh = 0.0;
      for (int i = 0; i < 24; i++)
        c1_hourly_kwh[i] = 0.0f;
    }
  }
  lastRecordedHour = currentHour;
  if (currentHour >= 0 && currentHour < 24) {
    c1_hourly_kwh[currentHour] += (float)deltaKwh1;
  }

  // Periodic persistence to ESP32 Flash (every 5 minutes)
  if (now - lastEnergySaveNvsMs >= 300000) {
    lastEnergySaveNvsMs = now;
    if (lockNVS()) {
      preferences.putFloat("c1_kwh", (float)c1_accumulated_kwh);
      preferences.putFloat("c2_kwh", (float)c2_accumulated_kwh);
      unlockNVS();
    }
  }
}

// ==========================================
// --- SERVO HARDWARE CONTROL ---
// ==========================================
void updateServos() {
  unsigned long now = millis();

  // Target angles based on curtain states
  target_c1_angle = state_c1_curtain ? SERVO_OPEN_ANGLE : SERVO_CLOSED_ANGLE;
  target_c2_angle = state_c2_curtain ? SERVO_OPEN_ANGLE : SERVO_CLOSED_ANGLE;

  // Servo 1 (Classroom 1)
  if (current_c1_angle != target_c1_angle) {
    if (!servo1_attached) {
      curtain1.attach(SERVO1_PIN);
      servo1_attached = true;
    }
    if (now - last_servo1_move >= SERVO_SPEED_MS) {
      last_servo1_move = now;
      if (current_c1_angle < target_c1_angle)
        current_c1_angle++;
      else
        current_c1_angle--;
      curtain1.write(current_c1_angle);
    }
  } else {
    // Detach after sitting idle to eliminate servo hum and save power
    if (servo1_attached && (now - last_servo1_move > SERVO_IDLE_DETACH)) {
      curtain1.detach();
      servo1_attached = false;
    }
  }

  // Servo 2 (Classroom 2)
  if (current_c2_angle != target_c2_angle) {
    if (!servo2_attached) {
      curtain2.attach(SERVO2_PIN);
      servo2_attached = true;
    }
    if (now - last_servo2_move >= SERVO_SPEED_MS) {
      last_servo2_move = now;
      if (current_c2_angle < target_c2_angle)
        current_c2_angle++;
      else
        current_c2_angle--;
      curtain2.write(current_c2_angle);
    }
  } else {
    if (servo2_attached && (now - last_servo2_move > SERVO_IDLE_DETACH)) {
      curtain2.detach();
      servo2_attached = false;
    }
  }
}

// ==========================================
// --- SYSTEM MODE CONTROLLER (NVS PERSISTENT) ---
// ==========================================
void setSystemModeInternal(bool autoMode, bool notifyCloud) {
  if (isAutoMode != autoMode) {
    isAutoMode = autoMode;
    cloud_prev_system_auto = autoMode;
    if (lockNVS()) {
      preferences.putBool("auto_mode", autoMode);
      unlockNVS();
    }
    if (notifyCloud) {
      pendingModeCloudSync = true;
      lastLocalModeChange = millis();
    }
    Serial.printf("[SYSTEM] Mode updated -> %s (saved to NVS)\n",
                  isAutoMode ? "AUTO" : "MANUAL");
  }
}

// ==========================================
// --- PHYSICAL RELAY SYNCHRONIZATION ---
// ==========================================
// Staggered & state-cached relay actuation to prevent simultaneous coil inrush
// current spikes
void applyRelayStates() {
  static int hw_c1_light = -1;
  static int hw_c1_fan = -1;
  static int hw_c2_light = -1;
  static int hw_c2_fan = -1;
  static int hw_corr1 = -1;
  static int hw_corr2 = -1;

  static unsigned long last_switch_c1_l = 0;
  static unsigned long last_switch_c1_f = 0;
  static unsigned long last_switch_c2_l = 0;
  static unsigned long last_switch_c2_f = 0;
  static unsigned long last_switch_corr1 = 0;
  static unsigned long last_switch_corr2 = 0;

  unsigned long now = millis();

  int t_c1_l = state_c1_light ? RELAY_ON : RELAY_OFF;
  if (hw_c1_light != t_c1_l && (hw_c1_light == -1 || now - last_switch_c1_l >= RELAY_MIN_SWITCH_INTERVAL_MS)) {
    digitalWrite(RELAY_CLASS_LIGHT1, t_c1_l);
    hw_c1_light = t_c1_l;
    last_switch_c1_l = now;
  }

  int t_c1_f = state_c1_fan ? RELAY_ON : RELAY_OFF;
  if (hw_c1_fan != t_c1_f && (hw_c1_fan == -1 || now - last_switch_c1_f >= RELAY_MIN_SWITCH_INTERVAL_MS)) {
    digitalWrite(RELAY_CLASS_FAN1, t_c1_f);
    hw_c1_fan = t_c1_f;
    last_switch_c1_f = now;
  }

  int t_c2_l = state_c2_light ? RELAY_ON : RELAY_OFF;
  if (hw_c2_light != t_c2_l && (hw_c2_light == -1 || now - last_switch_c2_l >= RELAY_MIN_SWITCH_INTERVAL_MS)) {
    digitalWrite(RELAY_CLASS_LIGHT2, t_c2_l);
    hw_c2_light = t_c2_l;
    last_switch_c2_l = now;
  }

  int t_c2_f = state_c2_fan ? RELAY_ON : RELAY_OFF;
  if (hw_c2_fan != t_c2_f && (hw_c2_fan == -1 || now - last_switch_c2_f >= RELAY_MIN_SWITCH_INTERVAL_MS)) {
    digitalWrite(RELAY_CLASS_FAN2, t_c2_f);
    hw_c2_fan = t_c2_f;
    last_switch_c2_f = now;
  }

  int t_cr1 = state_corr1_light ? RELAY_ON : RELAY_OFF;
  if (hw_corr1 != t_cr1 && (hw_corr1 == -1 || now - last_switch_corr1 >= RELAY_MIN_SWITCH_INTERVAL_MS)) {
    digitalWrite(RELAY_CORRIDOR_LIGHT1, t_cr1);
    hw_corr1 = t_cr1;
    last_switch_corr1 = now;
  }

  int t_cr2 = state_corr2_light ? RELAY_ON : RELAY_OFF;
  if (hw_corr2 != t_cr2 && (hw_corr2 == -1 || now - last_switch_corr2 >= RELAY_MIN_SWITCH_INTERVAL_MS)) {
    digitalWrite(RELAY_CORRIDOR_LIGHT2, t_cr2);
    hw_corr2 = t_cr2;
    last_switch_corr2 = now;
  }
}

// ==========================================
// --- WS2812B 15-LED STRIP CONTROLLER ---
// ==========================================
uint32_t parseHexColor(const String &hexStr) {
  String h = hexStr;
  h.replace("#", "");
  h.trim();
  if (h.length() == 3) {
    char rHex[3] = { h[0], h[0], '\0' };
    char gHex[3] = { h[1], h[1], '\0' };
    char bHex[3] = { h[2], h[2], '\0' };
    uint8_t r = strtol(rHex, NULL, 16);
    uint8_t g = strtol(gHex, NULL, 16);
    uint8_t b = strtol(bHex, NULL, 16);
    return strip.Color(r, g, b);
  }
  if (h.length() != 6) {
    return strip.Color(255, 107, 0); // fallback warm amber
  }
  long number = strtol(h.c_str(), NULL, 16);
  long r = (number >> 16) & 0xFF;
  long g = (number >> 8) & 0xFF;
  long b = number & 0xFF;
  return strip.Color((uint8_t)r, (uint8_t)g, (uint8_t)b);
}

void updateWs2812Strip() {
  if (!state_ws2812) {
    strip.clear();
    strip.show();
    Serial.println(F("[WS2812] Strip turned OFF"));
    return;
  }

  if (ws2812_brightness <= 0) {
    ws2812_brightness = WS2812_DEFAULT_BRIGHTNESS;
  } else {
    ws2812_brightness = constrain(ws2812_brightness, 5, 255);
  }
  strip.setBrightness(ws2812_brightness);

  Serial.printf("[WS2812] Strip turned ON | Pin: GPIO %d | LEDs: %d | Mode: %s | Color: %s | Brightness: %d\n",
                WS2812_PIN, WS2812_NUM_LEDS, ws2812_mode.c_str(), ws2812_color.c_str(), ws2812_brightness);

  if (ws2812_mode == "rainbow" || ws2812_mode == "breathe" || ws2812_mode == "strobe" || ws2812_mode == "chase" || ws2812_mode == "fire") {
    // Handled dynamically in updateWs2812Animation()
    last_ws2812_anim_ms = 0;
    return;
  }

  // Default: Solid Color
  uint32_t c = parseHexColor(ws2812_color);
  for (int i = 0; i < WS2812_NUM_LEDS; i++) {
    strip.setPixelColor(i, c);
  }
  strip.show();
}

void syncWs2812Hardware() {
  static bool last_applied_state = false;
  static String last_applied_color = "";
  static int last_applied_brightness = -1;
  static String last_applied_mode = "";

  bool stateChanged = (state_ws2812 != last_applied_state);
  bool settingsChanged = (ws2812_color != last_applied_color || 
                          ws2812_brightness != last_applied_brightness || 
                          ws2812_mode != last_applied_mode);

  if (ws2812_needs_update || stateChanged || (state_ws2812 && settingsChanged)) {
    ws2812_needs_update = false;
    last_applied_state = state_ws2812;
    last_applied_color = ws2812_color;
    last_applied_brightness = ws2812_brightness;
    last_applied_mode = ws2812_mode;
    updateWs2812Strip();
  }
}

void updateWs2812Animation() {
  syncWs2812Hardware();
  if (!state_ws2812) return;

  unsigned long now = millis();

  if (ws2812_mode == "breathe") {
    if (now - last_ws2812_anim_ms >= 25) {
      last_ws2812_anim_ms = now;
      ws2812_anim_step = (ws2812_anim_step + 4) % 360;
      float rad = ws2812_anim_step * (3.14159265f / 180.0f);
      // Smooth sinusoidal breathing factor (20% to 100%)
      float factor = 0.20f + 0.80f * (0.5f + 0.5f * sin(rad));
      
      uint32_t baseColor = parseHexColor(ws2812_color);
      uint8_t r = (uint8_t)(((baseColor >> 16) & 0xFF) * factor);
      uint8_t g = (uint8_t)(((baseColor >> 8) & 0xFF) * factor);
      uint8_t b = (uint8_t)((baseColor & 0xFF) * factor);
      uint32_t scaledColor = strip.Color(r, g, b);

      strip.setBrightness(ws2812_brightness);
      for (int i = 0; i < WS2812_NUM_LEDS; i++) {
        strip.setPixelColor(i, scaledColor);
      }
      strip.show();
    }
  } else if (ws2812_mode == "rainbow") {
    if (now - last_ws2812_anim_ms >= 25) {
      last_ws2812_anim_ms = now;
      ws2812_anim_step = (ws2812_anim_step + 256) % 65536;
      for (int i = 0; i < WS2812_NUM_LEDS; i++) {
        int pixelHue = (ws2812_anim_step + (i * 65536L / WS2812_NUM_LEDS)) % 65536;
        strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(pixelHue)));
      }
      strip.show();
    }
  } else if (ws2812_mode == "strobe") {
    if (now - last_ws2812_anim_ms >= 150) {
      last_ws2812_anim_ms = now;
      ws2812_strobe_state = !ws2812_strobe_state;
      if (ws2812_strobe_state) {
        uint32_t c = parseHexColor(ws2812_color);
        for (int i = 0; i < WS2812_NUM_LEDS; i++) {
          strip.setPixelColor(i, c);
        }
      } else {
        strip.clear();
      }
      strip.show();
    }
  } else if (ws2812_mode == "chase") {
    if (now - last_ws2812_anim_ms >= 45) {
      last_ws2812_anim_ms = now;
      ws2812_anim_step = (ws2812_anim_step + 1) % WS2812_NUM_LEDS;
      uint32_t c = parseHexColor(ws2812_color);
      for (int i = 0; i < WS2812_NUM_LEDS; i++) {
        if (i == ws2812_anim_step || i == (ws2812_anim_step + 1) % WS2812_NUM_LEDS) {
          strip.setPixelColor(i, c);
        } else {
          strip.setPixelColor(i, 0);
        }
      }
      strip.show();
    }
  } else if (ws2812_mode == "fire") {
    if (now - last_ws2812_anim_ms >= 55) {
      last_ws2812_anim_ms = now;
      for (int i = 0; i < WS2812_NUM_LEDS; i++) {
        int flicker = random(0, 50);
        int r1 = constrain(255 - flicker, 0, 255);
        int g1 = constrain(90 - flicker, 0, 255);
        int b1 = constrain(10 - (flicker / 2), 0, 255);
        strip.setPixelColor(i, strip.Color(r1, g1, b1));
      }
      strip.show();
    }
  } else {
    // Mode "solid" or default: conservative keep-alive refresh every 30s for noise resilience
    static unsigned long lastSolidRefresh = 0;
    if (now - lastSolidRefresh >= 30000UL) {
      lastSolidRefresh = now;
      uint32_t c = parseHexColor(ws2812_color);
      for (int i = 0; i < WS2812_NUM_LEDS; i++) {
        strip.setPixelColor(i, c);
      }
      strip.show();
    }
  }
}

void handleApiRgb() {
  enableCORS();
  if (server.method() == HTTP_OPTIONS) {
    server.send(204);
    return;
  }

  bool st = state_ws2812;
  bool stateProvided = false;

  if (server.hasArg("state") || server.hasArg("st")) {
    String stVal = server.hasArg("state") ? server.arg("state") : server.arg("st");
    st = (stVal == "1" || stVal == "true" || stVal == "on");
    stateProvided = true;
  }

  if (server.hasArg("color")) {
    ws2812_color = server.arg("color");
  }

  if (server.hasArg("brightness") || server.hasArg("b")) {
    String bVal = server.hasArg("brightness") ? server.arg("brightness") : server.arg("b");
    int bPct = bVal.toInt();
    ws2812_brightness = map(constrain(bPct, 0, 100), 0, 100, 0, 255);
  }

  if (server.hasArg("mode")) {
    ws2812_mode = server.arg("mode");
    last_ws2812_anim_ms = 0;
    lastWs2812LocalChange = millis();
  } else if (server.hasArg("rgbMode")) {
    ws2812_mode = server.arg("rgbMode");
    last_ws2812_anim_ms = 0;
    lastWs2812LocalChange = millis();
  }

  if (server.hasArg("plain")) {
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (!err) {
      if (doc.containsKey("state")) { st = doc["state"].as<bool>(); stateProvided = true; }
      if (doc.containsKey("st")) { st = doc["st"].as<bool>(); stateProvided = true; }
      if (doc.containsKey("color")) ws2812_color = doc["color"].as<String>();
      if (doc.containsKey("brightness")) {
        int bPct = doc["brightness"].as<int>();
        ws2812_brightness = map(constrain(bPct, 0, 100), 0, 100, 0, 255);
      }
      if (doc.containsKey("b")) {
        int bPct = doc["b"].as<int>();
        ws2812_brightness = map(constrain(bPct, 0, 100), 0, 100, 0, 255);
      }
      if (doc.containsKey("mode")) {
        ws2812_mode = doc["mode"].as<String>();
        last_ws2812_anim_ms = 0;
        lastWs2812LocalChange = millis();
      } else if (doc.containsKey("rgbMode")) {
        ws2812_mode = doc["rgbMode"].as<String>();
        last_ws2812_anim_ms = 0;
        lastWs2812LocalChange = millis();
      }
    }
  }

  // If power state was explicitly provided or strip is being modified, route through applyDeviceControl
  lastWs2812LocalChange = millis();
  applyDeviceControl("rgb", stateProvided ? st : state_ws2812);

  int bPctOut = (int)round((ws2812_brightness * 100.0) / 255.0);
  String resp = "{\"status\":\"ok\",\"device\":\"dev-corr-rgb-strip\",\"power\":";
  resp += (state_ws2812 ? "true" : "false");
  resp += ",\"color\":\"" + ws2812_color + "\"";
  resp += ",\"brightness\":" + String(bPctOut);
  resp += ",\"mode\":\"" + ws2812_mode + "\"}";

  server.send(200, "application/json", resp);
}

// ==========================================
// --- HTTP / CORS HELPERS ---
// ==========================================
void enableCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT");
  server.sendHeader("Access-Control-Allow-Headers",
                    "Content-Type, Authorization, X-Requested-With");
}

void handleOptions() {
  enableCORS();
  server.send(204);
}

void handleNotFound() {
  enableCORS();
  if (isApSetupMode) {
    // Captive portal probes & unknown domains redirect to the Wi-Fi setup portal
    String host = server.hostHeader();
    if (host != "192.168.4.1" && host != "esp32-classroom.local") {
      server.sendHeader("Location", "http://192.168.4.1/wifi", true);
      server.send(302, "text/plain", "");
      return;
    }
    handleWiFiPortal();
    return;
  }
  handleOptions();
}

// ==========================================
// --- REST API: STATUS ---
// ==========================================
// Generates status JSON (100% backward compatible with original code + app
// fields)
String buildStatusJson(bool includeTelemetry = true) {
  String json = "{";
  json.reserve(2048);
  json += "\"status\":\"ok\",";
  json += "\"mode\":\"" + String(isAutoMode ? "auto" : "manual") + "\",";
  json += "\"temperature\":" + String(currentTemp, 1) + ",";
  json += "\"humidity\":" + String(currentHum, 1) + ",";
  json += "\"total_load_watts\":" + String(getTotalLoadWatts(), 1) + ",";

  // Classroom 1 (cls-a101) - Equipped with ACS712 & ZMPT101B
  json += "\"classroom1\":{";
  json += "\"id\":\"" + String(CLASSROOM_1_ID) + "\",";
  json += "\"name\":\"" + String(CLASSROOM_1_NAME) + "\",";
  json += "\"room\":\"" + String(CLASSROOM_1_NUM) + "\",";
  json += "\"motion\":" + String(pir1_active ? "true" : "false") + ",";
  json += "\"occupied\":" + String(c1_occupied ? "true" : "false") + ",";
  json += "\"light\":" + String(state_c1_light ? "true" : "false") + ",";
  json += "\"fan\":" + String(state_c1_fan ? "true" : "false") + ",";
  json += "\"curtain\":" + String(state_c1_curtain ? "true" : "false") + ",";
  json += "\"curtain_angle\":" + String(current_c1_angle) + ",";
  json += "\"smart_screen\":" + String(state_c1_smart_screen ? "true" : "false") + ",";
  json += "\"notice_board\":" + String(state_c1_notice_screen ? "true" : "false") + ",";
  json += "\"load_watts\":" + String(getC1LoadWatts(), 1) + ",";
  json += "\"voltage\":" + String(c1_voltage, 1) + ",";
  json += "\"current\":" + String(c1_current, 2) + ",";
  json += "\"power_watts\":" + String(c1_real_power, 1) + ",";
  json += "\"energy_today\":" + String(c1_accumulated_kwh, 4) + ",";
  json += "\"estimated_cost\":" + String(c1_accumulated_kwh * 8.0, 2) + ",";
  json += "\"has_power_meter\":true";
  json += "},";

  // Classroom 2 (cls-a102) - Standard setup (No Power Meter)
  json += "\"classroom2\":{";
  json += "\"id\":\"" + String(CLASSROOM_2_ID) + "\",";
  json += "\"name\":\"" + String(CLASSROOM_2_NAME) + "\",";
  json += "\"room\":\"" + String(CLASSROOM_2_NUM) + "\",";
  json += "\"motion\":" + String(pir2_active ? "true" : "false") + ",";
  json += "\"occupied\":" + String(c2_occupied ? "true" : "false") + ",";
  json += "\"light\":" + String(state_c2_light ? "true" : "false") + ",";
  json += "\"fan\":" + String(state_c2_fan ? "true" : "false") + ",";
  json += "\"curtain\":" + String(state_c2_curtain ? "true" : "false") + ",";
  json += "\"curtain_angle\":" + String(current_c2_angle) + ",";
  json += "\"load_watts\":" + String(getC2LoadWatts(), 1) + ",";
  json += "\"voltage\":0.0,";
  json += "\"current\":0.0,";
  json += "\"power_watts\":0.0,";
  json += "\"energy_today\":" + String(c2_accumulated_kwh, 4) + ",";
  json += "\"estimated_cost\":" + String(c2_accumulated_kwh * 8.0, 2) + ",";
  json += "\"has_power_meter\":false";
  json += "},";

  // Corridors
  json += "\"corridors\":{";
  json += "\"ldr1_raw\":" + String(ldr1_value) + ",";
  json += "\"light1\":" + String(state_corr1_light ? "true" : "false") + ",";
  json += "\"ldr2_raw\":" + String(ldr2_value) + ",";
  json += "\"light2\":" + String(state_corr2_light ? "true" : "false") + ",";
  json += "\"rgb\":{";
  json += "\"power\":" + String(state_ws2812 ? "true" : "false") + ",";
  json += "\"color\":\"" + ws2812_color + "\",";
  json += "\"brightness\":" + String((int)round((ws2812_brightness * 100.0) / 255.0)) + ",";
  json += "\"mode\":\"" + ws2812_mode + "\"";
  json += "}";
  json += "},";

  // Real 24-hour Energy Consumption Array (for App Consumption Charts)
  json += "\"hourly_energy\":[";
  for (int h = 0; h < 24; h++) {
    json += String(c1_hourly_kwh[h], 4);
    if (h < 23)
      json += ",";
  }
  json += "]";

  if (includeTelemetry) {
    json += ",\"controller\":{";
    json += "\"firmware\":\"" + String(FIRMWARE_VERSION) + "\",";
    json += "\"ssid\":\"" + String(WiFi.SSID()) + "\",";
    json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
    json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
    json += "\"uptime_sec\":" + String(millis() / 1000) + ",";
    json += "\"free_heap\":" + String(ESP.getFreeHeap()) + ",";
    json += "\"notice_count\":" + String(noticeCount);
    json += "}";
  } else {
    json += ",\"notice_count\":" + String(noticeCount);
  }

  json += "}";
  return json;
}

void handleStatus() {
  enableCORS();
  server.send(200, "application/json", buildStatusJson(true));
}

// ==========================================
// --- REST API: MODE ---
// ==========================================
void handleMode() {
  enableCORS();
  if (server.hasArg("auto")) {
    setSystemModeInternal(
        server.arg("auto") == "1" || server.arg("auto") == "true", true);
  } else if (server.hasArg("plain")) {
    String body = server.arg("plain");
    if (body.indexOf("\"auto\":true") >= 0 || body.indexOf("\"auto\":1") >= 0) {
      setSystemModeInternal(true, true);
    } else if (body.indexOf("\"auto\":false") >= 0 ||
               body.indexOf("\"auto\":0") >= 0) {
      setSystemModeInternal(false, true);
    }
  }
  server.send(200, "application/json",
              "{\"status\":\"ok\",\"mode\":\"" +
                  String(isAutoMode ? "auto" : "manual") + "\"}");
}

// ==========================================
// --- REST API: CONTROL ---
// ==========================================
// Supports legacy query params (dev=l1&st=1) AND modern app device IDs
void applyDeviceControl(String dev, bool st) {
  dev.toLowerCase();

  // Track turn-on timestamp for onboard auto-off countdown timer & anti-echo shield
  int schedIdx = getDeviceScheduleIndex(dev);
  if (schedIdx >= 0) {
    lastLocalDeviceControlMs[schedIdx] = millis();
    if (st) {
      deviceSchedules[schedIdx].turnOnTimestampMs = millis();
    } else {
      deviceSchedules[schedIdx].turnOnTimestampMs = 0;
    }
  }

  // Classroom 1 / A101
  if (dev == "l1" || dev == "light1" || dev == "dev-a101-light" ||
      dev == "dev-a101-light-1" || dev == "dev-a101-light-2") {
    state_c1_light = st;
    cloud_prev_c1_light = st;
  } else if (dev == "f1" || dev == "fan1" || dev == "dev-a101-fan" ||
             dev == "dev-a101-fan-1" || dev == "dev-a101-fan-2") {
    state_c1_fan = st;
    cloud_prev_c1_fan = st;
  } else if (dev == "c1" || dev == "curtain1" || dev == "dev-a101-curtain") {
    state_c1_curtain = st;
    cloud_prev_c1_curtain = st;
  } else if (dev == "nb" || dev == "notice" || dev == "notice_board" ||
             dev == "dev-a101-notice-board" || dev == "dev-a101-notice") {
    setNoticeScreenPower(st);
    cloud_prev_c1_notice_board = st;
  } else if (dev == "ss" || dev == "smart" || dev == "smart_screen" ||
             dev == "dev-a101-smart-screen" || dev == "dev-a101-screen") {
    setSmartScreenPower(st);
    cloud_prev_c1_smart_screen = st;
  }
  // Classroom 2 / A102
  else if (dev == "l2" || dev == "light2" || dev == "dev-a102-light" ||
           dev == "dev-a102-light-1" || dev == "dev-a102-light-2") {
    state_c2_light = st;
    cloud_prev_c2_light = st;
  } else if (dev == "f2" || dev == "fan2" || dev == "dev-a102-fan" ||
             dev == "dev-a102-fan-1" || dev == "dev-a102-fan-2") {
    state_c2_fan = st;
    cloud_prev_c2_fan = st;
  } else if (dev == "c2" || dev == "curtain2" || dev == "dev-a102-curtain") {
    state_c2_curtain = st;
    cloud_prev_c2_curtain = st;
  }
  // Corridors
  else if (dev == "cr1" || dev == "corridor1" || dev == "corr1" ||
           dev == "dev-corr-light1" || dev == "dev-corr-light-1") {
    state_corr1_light = st;
    cloud_prev_corr1_light = st;
  } else if (dev == "cr2" || dev == "corridor2" || dev == "corr2" ||
           dev == "dev-corr-light2" || dev == "dev-corr-light-2") {
    state_corr2_light = st;
    cloud_prev_corr2_light = st;
  } else if (dev == "rgb" || dev == "ws2812" || dev == "rgb_strip" ||
             dev == "dev-corr-rgb-strip") {
    state_ws2812 = st;
    cloud_prev_ws2812 = st;
    lastWs2812LocalChange = millis();
    updateWs2812Strip();
  }
  // Group Commands (Atomic actuation of all devices in a category)
  else if (dev == "all_lights" || dev == "all-lights" || dev == "lights") {
    state_c1_light = st;
    state_c2_light = st;
    state_corr1_light = st;
    state_corr2_light = st;
    state_ws2812 = st;
    updateWs2812Strip();

    cloud_prev_c1_light = st;
    cloud_prev_c2_light = st;
    cloud_prev_corr1_light = st;
    cloud_prev_corr2_light = st;
    cloud_prev_ws2812 = st;

    unsigned long nowMs = millis();
    int lightIndices[] = {0, 5, 8, 9, 10};
    for (int idx : lightIndices) {
      lastLocalDeviceControlMs[idx] = nowMs;
      deviceSchedules[idx].turnOnTimestampMs = st ? nowMs : 0;
    }
    lastWs2812LocalChange = nowMs;
    Serial.printf("[GROUP CONTROL] All Lights -> %s\n", st ? "ON" : "OFF");
  } else if (dev == "all_fans" || dev == "all-fans" || dev == "fans") {
    state_c1_fan = st;
    state_c2_fan = st;

    cloud_prev_c1_fan = st;
    cloud_prev_c2_fan = st;

    unsigned long nowMs = millis();
    int fanIndices[] = {1, 6};
    for (int idx : fanIndices) {
      lastLocalDeviceControlMs[idx] = nowMs;
      deviceSchedules[idx].turnOnTimestampMs = st ? nowMs : 0;
    }
    Serial.printf("[GROUP CONTROL] All Fans -> %s\n", st ? "ON" : "OFF");
  } else if (dev == "all_curtains" || dev == "all-curtains" || dev == "curtains") {
    state_c1_curtain = st;
    state_c2_curtain = st;

    cloud_prev_c1_curtain = st;
    cloud_prev_c2_curtain = st;

    unsigned long nowMs = millis();
    int curtainIndices[] = {2, 7};
    for (int idx : curtainIndices) {
      lastLocalDeviceControlMs[idx] = nowMs;
      deviceSchedules[idx].turnOnTimestampMs = st ? nowMs : 0;
    }
    Serial.printf("[GROUP CONTROL] All Curtains -> %s\n", st ? "OPEN" : "CLOSED");
  }
  // Bulk / Emergency Commands
  else if (dev == "all" || dev == "emergency") {
    state_c1_light = st;
    state_c1_fan = st;
    state_c1_curtain = st;
    state_c2_light = st;
    state_c2_fan = st;
    state_c2_curtain = st;
    state_corr1_light = st;
    state_corr2_light = st;
    state_ws2812 = st;
    updateWs2812Strip();
    setNoticeScreenPower(st);
    setSmartScreenPower(st);

    // Sync all cloud baseline tracking so upcoming polls do not fight bulk control
    cloud_prev_c1_light = st;
    cloud_prev_c1_fan = st;
    cloud_prev_c1_curtain = st;
    cloud_prev_c2_light = st;
    cloud_prev_c2_fan = st;
    cloud_prev_c2_curtain = st;
    cloud_prev_corr1_light = st;
    cloud_prev_corr2_light = st;
    cloud_prev_ws2812 = st;
    cloud_prev_c1_notice_board = st;
    cloud_prev_c1_smart_screen = st;

    unsigned long nowMs = millis();
    for (int i = 0; i < NUM_SCHEDULED_DEVICES; i++) {
      lastLocalDeviceControlMs[i] = nowMs;
      deviceSchedules[i].turnOnTimestampMs = st ? nowMs : 0;
    }
    lastWs2812LocalChange = nowMs;
  }

  // Instantly apply relay pin states
  applyRelayStates();
}

void handleControl() {
  enableCORS();

  // Handle Query Parameters (GET /ctrl?dev=l1&st=1)
  if (server.hasArg("dev") && (server.hasArg("st") || server.hasArg("color") || server.hasArg("b") || server.hasArg("mode"))) {
    String dev = server.arg("dev");
    bool st = (server.arg("st") == "1" || server.arg("st") == "true" ||
               server.arg("st") == "on");
    if (!server.hasArg("st")) {
      st = state_ws2812;
    }

    if (dev == "rgb" || dev == "ws2812" || dev == "rgb_strip" || dev == "dev-corr-rgb-strip") {
      lastWs2812LocalChange = millis();
      if (server.hasArg("color")) {
        ws2812_color = server.arg("color");
      }
      if (server.hasArg("b")) {
        int b = server.arg("b").toInt();
        ws2812_brightness = map(constrain(b, 0, 100), 0, 100, 0, 255);
      }
      if (server.hasArg("brightness")) {
        int b = server.arg("brightness").toInt();
        ws2812_brightness = map(constrain(b, 0, 100), 0, 100, 0, 255);
      }
      if (server.hasArg("mode")) {
        ws2812_mode = server.arg("mode");
        last_ws2812_anim_ms = 0;
      } else if (server.hasArg("rgbMode")) {
        ws2812_mode = server.arg("rgbMode");
        last_ws2812_anim_ms = 0;
      }
    }

    // Valid manual command received: Switch to manual mode
    if (isAutoMode) {
      setSystemModeInternal(false, true);
      Serial.println(
          F("[SYSTEM] Manual command received -> Switched to MANUAL Mode"));
    }

    applyDeviceControl(dev, st);
    int bPctOut = (int)round((ws2812_brightness * 100.0) / 255.0);
    server.send(200, "application/json",
                "{\"status\":\"ok\",\"device\":\"" + dev +
                    "\",\"state\":" + String(st ? "true" : "false") + 
                    ",\"color\":\"" + ws2812_color + "\",\"brightness\":" + String(bPctOut) + "}");
    return;
  }

  // Handle JSON POST Body (POST /api/control with {"dev":"l1","st":1} or
  // {"deviceId":"...","state":"..."})
  if (server.hasArg("plain")) {
    String body = server.arg("plain");
    String dev = "";
    bool st = false;

    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, body);
    if (!err) {
      if (doc.containsKey("dev")) {
        dev = doc["dev"].as<String>();
      } else if (doc.containsKey("deviceId")) {
        dev = doc["deviceId"].as<String>();
      }

      if (doc.containsKey("st")) {
        st = doc["st"].as<bool>() || (doc["st"].as<int>() == 1);
      } else if (doc.containsKey("state")) {
        String stStr = doc["state"].as<String>();
        st = (stStr == "1" || stStr == "true" || stStr == "on");
      }

      if (dev == "rgb" || dev == "ws2812" || dev == "rgb_strip" || dev == "dev-corr-rgb-strip") {
        lastWs2812LocalChange = millis();
        if (doc.containsKey("color")) ws2812_color = doc["color"].as<String>();
        if (doc.containsKey("brightness")) {
          int b = doc["brightness"].as<int>();
          ws2812_brightness = map(constrain(b, 0, 100), 0, 100, 0, 255);
        } else if (doc.containsKey("b")) {
          int b = doc["b"].as<int>();
          ws2812_brightness = map(constrain(b, 0, 100), 0, 100, 0, 255);
        }
        if (doc.containsKey("mode")) {
          ws2812_mode = doc["mode"].as<String>();
          last_ws2812_anim_ms = 0;
        } else if (doc.containsKey("rgbMode")) {
          ws2812_mode = doc["rgbMode"].as<String>();
          last_ws2812_anim_ms = 0;
        }
      }
    } else {
      // Fallback substring search if JSON is malformed
      if (body.indexOf("\"st\":1") >= 0 || body.indexOf("\"st\":true") >= 0 ||
          body.indexOf("\"state\":true") >= 0 ||
          body.indexOf("\"state\":\"on\"") >= 0) {
        st = true;
      }
      int devIdx = body.indexOf("\"dev\":\"");
      if (devIdx >= 0) {
        int start = devIdx + 7;
        int end = body.indexOf("\"", start);
        if (end > start)
          dev = body.substring(start, end);
      } else {
        int idIdx = body.indexOf("\"deviceId\":\"");
        if (idIdx >= 0) {
          int start = idIdx + 12;
          int end = body.indexOf("\"", start);
          if (end > start)
            dev = body.substring(start, end);
        }
      }
    }

    if (dev.length() > 0) {
      // Valid manual command received: Switch to manual mode
      if (isAutoMode) {
        setSystemModeInternal(false, true);
        Serial.println(
            F("[SYSTEM] Manual command received -> Switched to MANUAL Mode"));
      }
      applyDeviceControl(dev, st);
      server.send(200, "application/json",
                  "{\"status\":\"ok\",\"device\":\"" + dev +
                      "\",\"state\":" + String(st ? "true" : "false") + "}");
      return;
    }
  }

  server.send(400, "application/json",
              "{\"status\":\"error\",\"message\":\"Missing 'dev' and 'st' "
              "parameters\"}");
}

// ==========================================
// --- REST API: CONFIGURATION ---
// ==========================================
void handleConfig() {
  enableCORS();
  if (server.hasArg("temp_thresh")) {
    currentTempThreshold = server.arg("temp_thresh").toFloat();
  }
  if (server.hasArg("ldr_thresh")) {
    currentLdrThreshold = server.arg("ldr_thresh").toInt();
  }
  if (server.hasArg("hold_sec")) {
    currentHoldTime = server.arg("hold_sec").toInt() * 1000UL;
  }
  bool nvsLocked = lockNVS();
  if (server.hasArg("c1_light_w")) {
    rated_c1_light = server.arg("c1_light_w").toFloat();
    if (nvsLocked) preferences.putFloat("r_c1_l", rated_c1_light);
  }
  if (server.hasArg("c1_fan_w")) {
    rated_c1_fan = server.arg("c1_fan_w").toFloat();
    if (nvsLocked) preferences.putFloat("r_c1_f", rated_c1_fan);
  }
  if (server.hasArg("c2_light_w")) {
    rated_c2_light = server.arg("c2_light_w").toFloat();
    if (nvsLocked) preferences.putFloat("r_c2_l", rated_c2_light);
  }
  if (server.hasArg("c2_fan_w")) {
    rated_c2_fan = server.arg("c2_fan_w").toFloat();
    if (nvsLocked) preferences.putFloat("r_c2_f", rated_c2_fan);
  }
  if (server.hasArg("corr1_w")) {
    rated_corr1 = server.arg("corr1_w").toFloat();
    if (nvsLocked) preferences.putFloat("r_cr1", rated_corr1);
  }
  if (server.hasArg("corr2_w")) {
    rated_corr2 = server.arg("corr2_w").toFloat();
    if (nvsLocked) preferences.putFloat("r_cr2", rated_corr2);
  }
  if (server.hasArg("ws2812_w") || server.hasArg("rgb_w")) {
    String wArg = server.hasArg("ws2812_w") ? server.arg("ws2812_w") : server.arg("rgb_w");
    rated_ws2812 = wArg.toFloat();
    if (nvsLocked) preferences.putFloat("r_ws2812", rated_ws2812);
  }
  if (nvsLocked) unlockNVS();

  String json = "{";
  json += "\"status\":\"ok\",";
  json += "\"temp_threshold\":" + String(currentTempThreshold, 1) + ",";
  json += "\"ldr_threshold\":" + String(currentLdrThreshold) + ",";
  json += "\"hold_time_ms\":" + String(currentHoldTime) + ",";
  json += "\"c1_light_w\":" + String(rated_c1_light, 1) + ",";
  json += "\"c1_fan_w\":" + String(rated_c1_fan, 1);
  json += "}";
  server.send(200, "application/json", json);
}

// ==========================================
// --- WI-FI PROVISIONING & WEB PORTAL ---
// ==========================================
void handleWiFiPortal() {
  enableCORS();
  int n = WiFi.scanNetworks();

  String html = F("<!DOCTYPE html><html><head><meta charset='UTF-8'>"
                  "<meta name='viewport' content='width=device-width,initial-scale=1.0'>"
                  "<title>NBA Smart Classroom</title>"
                  "<style>"
                  "body{font-family:sans-serif;background:#0F0F0F;color:#FFF;margin:0;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;box-sizing:border-box;}"
                  ".card{background:#1A1A1A;border-radius:14px;padding:20px;max-width:380px;width:100%;box-shadow:0 8px 24px rgba(0,0,0,0.5);}"
                  ".badge{background:rgba(253,168,58,0.15);color:#FDA83A;font-weight:700;font-size:12px;padding:3px 8px;border-radius:12px;display:inline-block;margin-bottom:8px;}"
                  "h1{font-size:20px;margin:0 0 4px;color:#FFF;}"
                  "p{color:#A0A0A0;font-size:12px;margin:0 0 16px;}"
                  "label{display:block;font-size:12px;font-weight:600;color:#DDD;margin-bottom:4px;}"
                  "select,input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;background:#242424;border:1px solid #333;color:#FFF;font-size:14px;margin-bottom:12px;outline:none;}"
                  ".btn{width:100%;padding:12px;border-radius:8px;border:none;background:#FDA83A;color:#000;font-size:14px;font-weight:700;cursor:pointer;margin-top:4px;}"
                  ".info{margin-top:16px;padding-top:10px;border-top:1px solid #262626;font-size:11px;color:#777;display:flex;justify-content:space-between;}"
                  "</style></head><body>"
                  "<div class='card'>"
                  "<div class='badge'>Controller Setup</div>"
                  "<h1>Wi-Fi Config</h1>"
                  "<p>Select Wi-Fi network and enter password.</p>"
                  "<form action='/savewifi' method='POST'>"
                  "<label for='ssid'>Networks</label>"
                  "<select id='ssid' name='ssid' onchange='checkCustom(this.value)'>");

  if (n <= 0) {
    html += F("<option value=''>-- No networks found (Refresh) --</option>");
  } else {
    for (int i = 0; i < n; ++i) {
      String s = WiFi.SSID(i);
      int r = WiFi.RSSI(i);
      String lock = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "" : " 🔒";
      html += "<option value='" + s + "'>" + s + " (" + String(r) + " dBm" + lock + ")</option>";
    }
  }
  html += F("<option value='__custom__'>+ Enter custom SSID...</option>"
            "</select>"
            "<div id='customDiv' style='display:none;'>"
            "<label for='custom_ssid'>Custom SSID</label>"
            "<input type='text' id='custom_ssid' name='custom_ssid' placeholder='Network name'>"
            "</div>"
            "<label for='password'>Password</label>"
            "<input type='password' id='password' name='password' placeholder='Password'>"
            "<button type='submit' class='btn'>Connect & Save</button>"
            "</form>"
            "<div class='info'>"
            "<span>Firmware: v");
  html += FIRMWARE_VERSION;
  html += F("</span><span>IP: 192.168.4.1</span></div></div>"
            "<script>function checkCustom(v){document.getElementById('customDiv').style.display=(v==='__custom__')?'block':'none';}</script>"
            "</body></html>");

  server.send(200, "text/html", html);
}

void handleSaveWiFi() {
  enableCORS();
  String ssid = server.arg("ssid");
  if (ssid == "__custom__") {
    ssid = server.arg("custom_ssid");
  }
  String pass = server.arg("password");
  ssid.trim();
  pass.trim();

  if (ssid.length() == 0) {
    server.send(400, "text/html", "<h3>Error: SSID cannot be empty!</h3><p><a href='/wifi'>Go back</a></p>");
    return;
  }

  if (lockNVS()) {
    preferences.putString("wifi_ssid", ssid);
    preferences.putString("wifi_pass", pass);
    unlockNVS();
  }

  String html = F("<!DOCTYPE html><html><head><meta charset='UTF-8'>"
                  "<meta name='viewport' content='width=device-width,initial-scale=1.0'>"
                  "<title>Saving Wi-Fi...</title>"
                  "<style>"
                  "body{font-family:sans-serif;background:#0F0F0F;color:#FFF;margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;text-align:center;padding:20px;}"
                  ".card{background:#1A1A1A;border:1px solid #2D2D2D;border-radius:16px;padding:32px;max-width:380px;width:100%;}"
                  "h1{color:#4CAF50;font-size:22px;margin-bottom:12px;}"
                  "p{color:#A0A0A0;font-size:14px;line-height:1.6;}"
                  ".net{color:#FDA83A;font-weight:bold;}"
                  "</style></head><body>"
                  "<div class='card'>"
                  "<h1>&#x2705; Wi-Fi Saved!</h1>"
                  "<p>Connecting to <span class='net'>");
  html += ssid;
  html += F("</span>...</p>"
            "<p>The controller is restarting now. Please reconnect your phone to <span class='net'>");
  html += ssid;
  html += F("</span> to access the Smart Classroom app.</p>"
            "</div></body></html>");

  server.send(200, "text/html", html);

  if (oledFound) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(F("Wi-Fi Saved!"));
    display.println(F("Restarting..."));
    display.println(ssid);
    display.display();
  }

  delay(2000);
  ESP.restart();
}

void handleApiWiFi() {
  enableCORS();
  String ssid = "";
  String pass = "";

  if (server.hasArg("plain")) {
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (!err) {
      if (doc.containsKey("ssid")) ssid = doc["ssid"].as<String>();
      if (doc.containsKey("password")) pass = doc["password"].as<String>();
    }
  }
  if (ssid.length() == 0 && server.hasArg("ssid")) {
    ssid = server.arg("ssid");
    if (server.hasArg("password")) pass = server.arg("password");
  }

  ssid.trim();
  pass.trim();

  if (ssid.length() == 0) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing 'ssid' parameter\"}");
    return;
  }

  if (lockNVS()) {
    preferences.putString("wifi_ssid", ssid);
    preferences.putString("wifi_pass", pass);
    unlockNVS();
  }

  server.send(200, "application/json",
              "{\"status\":\"ok\",\"message\":\"Wi-Fi credentials saved. Restarting controller...\",\"ssid\":\"" + ssid + "\"}");

  if (oledFound) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(F("Wi-Fi Updated!"));
    display.println(F("Rebooting into:"));
    display.println(ssid);
    display.display();
  }

  delay(1500);
  ESP.restart();
}

void handleApiWiFiScan() {
  enableCORS();
  int n = WiFi.scanNetworks();
  String json = "[";
  for (int i = 0; i < n; ++i) {
    if (i > 0) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) +
            ",\"secure\":" + String((WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "false" : "true") + "}";
  }
  json += "]";
  server.send(200, "application/json", json);
}

void handleResetWiFi() {
  enableCORS();
  preferences.remove("wifi_ssid");
  preferences.remove("wifi_pass");
  server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Wi-Fi reset to defaults. Restarting in Setup mode...\"}");
  delay(1000);
  ESP.restart();
}

// ==========================================
// --- DIGITAL NOTICE BOARD LOGIC (Wire1 / GPIO 13 & 15) ---
// ==========================================
void cleanExpiredNotices() {
  if (!lockNotices()) return;
  unsigned long now = millis();
  for (int i = 0; i < noticeCount; i++) {
    if (notices[i].active && notices[i].durationMs > 0) {
      if (now - notices[i].createdAtMs >= notices[i].durationMs) {
        notices[i].active = false;
        Serial.printf("[NOTICE] Notice '%s' expired automatically.\n", notices[i].title.c_str());
      }
    }
  }
  // Compact array
  int writeIdx = 0;
  for (int i = 0; i < noticeCount; i++) {
    if (notices[i].active) {
      if (writeIdx != i) {
        notices[writeIdx] = notices[i];
      }
      writeIdx++;
    }
  }
  noticeCount = writeIdx;
  unlockNotices();
}

// Forward declarations for NVS persistence
void saveNoticesToNVS();
void loadNoticesFromNVS();

void saveNoticesToNVS() {
  if (!lockNVS()) return;
  StaticJsonDocument<2048> doc;
  JsonArray arr = doc.to<JsonArray>();
  if (lockNotices()) {
    for (int i = 0; i < noticeCount; i++) {
      if (notices[i].active) {
        JsonObject obj = arr.createNestedObject();
        obj["id"] = notices[i].id;
        obj["cls"] = notices[i].classroomId;
        obj["t"] = notices[i].title;
        obj["m"] = notices[i].message;
        obj["d"] = notices[i].duration;
      }
    }
    unlockNotices();
  }
  String out;
  serializeJson(doc, out);
  preferences.putString("notices_json", out);
  unlockNVS();
  Serial.printf("[NVS] Saved %d notices to persistent flash memory.\n", arr.size());
}

void loadNoticesFromNVS() {
  if (!lockNVS()) return;
  String stored = preferences.getString("notices_json", "");
  unlockNVS();
  if (stored.length() > 5) {
    StaticJsonDocument<2048> doc;
    DeserializationError err = deserializeJson(doc, stored);
    if (!err && doc.is<JsonArray>()) {
      if (lockNotices()) {
        noticeCount = 0;
        for (JsonObject obj : doc.as<JsonArray>()) {
          const char* id = obj["id"];
          const char* cls = obj["cls"];
          const char* t = obj["t"];
          const char* m = obj["m"];
          const char* d = obj["d"];
          if (id && t && m && noticeCount < MAX_FIRMWARE_NOTICES) {
            notices[noticeCount].id = String(id);
            notices[noticeCount].classroomId = cls ? String(cls) : "all";
            notices[noticeCount].title = String(t);
            notices[noticeCount].message = String(m);
            notices[noticeCount].duration = d ? String(d) : "24h";

            String durStr = notices[noticeCount].duration;
            durStr.toLowerCase();
            if (durStr == "1h") notices[noticeCount].durationMs = 3600000UL;
            else if (durStr == "24h" || durStr == "1d") notices[noticeCount].durationMs = 86400000UL;
            else notices[noticeCount].durationMs = 0;

            notices[noticeCount].createdAtMs = millis();
            notices[noticeCount].active = true;
            noticeCount++;
          }
        }
        unlockNotices();
        Serial.printf("[NOTICE] Restored %d persistent notices from NVS flash memory.\n", noticeCount);
      }
    }
  }
}

void addOrUpdateNotice(String id, String clsId, String title, String msg, String duration, bool triggerPopup = true, bool saveNvs = true) {
  cleanExpiredNotices();
  unsigned long durMs = 0;
  duration.toLowerCase();
  if (duration == "1h") {
    durMs = 3600000UL;
  } else if (duration == "24h" || duration == "1d") {
    durMs = 86400000UL;
  } else {
    durMs = 0; // "never" / until manually deleted
  }

  if (!lockNotices()) return;

  // Check if notice with this id already exists (update in place)
  for (int i = 0; i < noticeCount; i++) {
    if (notices[i].id == id) {
      bool contentChanged = (notices[i].title != title || notices[i].message != msg);
      notices[i].classroomId = clsId;
      notices[i].title = title;
      notices[i].message = msg;
      notices[i].duration = duration;
      notices[i].durationMs = durMs;
      notices[i].createdAtMs = millis();
      notices[i].active = true;
      if (triggerPopup && contentChanged) {
        newNoticePopupUntilMs = millis() + 15000UL;
        activeNoticePopupIndex = i;
        triggerNoticeBeep();
      }
      currentNoticeDisplayIndex = i;
      unlockNotices();
      if (saveNvs) saveNoticesToNVS();
      Serial.printf("[NOTICE] Updated notice '%s' (Target: %s)\n", title.c_str(), clsId.c_str());
      return;
    }
  }

  // Add new notice
  int targetIdx = noticeCount;
  if (noticeCount < MAX_FIRMWARE_NOTICES) {
    notices[noticeCount].id = id;
    notices[noticeCount].classroomId = clsId;
    notices[noticeCount].title = title;
    notices[noticeCount].message = msg;
    notices[noticeCount].duration = duration;
    notices[noticeCount].durationMs = durMs;
    notices[noticeCount].createdAtMs = millis();
    notices[noticeCount].active = true;
    targetIdx = noticeCount;
    noticeCount++;
  } else {
    // If array full, rotate out oldest notice
    for (int i = 0; i < MAX_FIRMWARE_NOTICES - 1; i++) {
      notices[i] = notices[i + 1];
    }
    int lastIdx = MAX_FIRMWARE_NOTICES - 1;
    notices[lastIdx].id = id;
    notices[lastIdx].classroomId = clsId;
    notices[lastIdx].title = title;
    notices[lastIdx].message = msg;
    notices[lastIdx].duration = duration;
    notices[lastIdx].durationMs = durMs;
    notices[lastIdx].createdAtMs = millis();
    notices[lastIdx].active = true;
    targetIdx = lastIdx;
  }
  unlockNotices();

  if (triggerPopup) {
    newNoticePopupUntilMs = millis() + 15000UL;
    activeNoticePopupIndex = targetIdx;
    triggerNoticeBeep();
  }
  currentNoticeDisplayIndex = targetIdx;
  singleOledNoticeIdx = targetIdx;
  if (saveNvs) saveNoticesToNVS();
  Serial.printf("[NOTICE] Added notice '%s' (Target: %s, Duration: %s, Total: %d)\n",
                title.c_str(), clsId.c_str(), duration.c_str(), noticeCount);
}

bool deleteNoticeById(String id) {
  if (!lockNotices()) return false;
  for (int i = 0; i < noticeCount; i++) {
    if (notices[i].id == id) {
      for (int j = i; j < noticeCount - 1; j++) {
        notices[j] = notices[j + 1];
      }
      noticeCount--;
      if (currentNoticeDisplayIndex >= noticeCount) {
        currentNoticeDisplayIndex = 0;
      }
      if (activeNoticePopupIndex == i) {
        newNoticePopupUntilMs = 0; // Dismiss popup immediately if active notice is deleted
      } else if (activeNoticePopupIndex > i) {
        activeNoticePopupIndex--;
      }
      unlockNotices();
      saveNoticesToNVS();
      Serial.printf("[NOTICE] Deleted notice id '%s'\n", id.c_str());
      return true;
    }
  }
  unlockNotices();
  return false;
}

// Pre-counts how many lines a message requires when wrapped to maxCharsPerLine (21 chars)
int countNoticeLines(const String &text, int maxCharsPerLine) {
  int currentLine = 0;
  int lineCharCount = 0;
  int len = text.length();
  int wordStart = 0;
  while (wordStart < len) {
    int nextSpace = text.indexOf(' ', wordStart);
    int nextNewline = text.indexOf('\n', wordStart);
    int wordEnd = len;
    bool isNewline = false;

    if (nextSpace != -1 && (nextNewline == -1 || nextSpace < nextNewline)) {
      wordEnd = nextSpace;
    } else if (nextNewline != -1) {
      wordEnd = nextNewline;
      isNewline = true;
    }

    String word = text.substring(wordStart, wordEnd);
    int wordLen = word.length();

    if (wordLen == 0 && isNewline) {
      currentLine++;
      lineCharCount = 0;
      wordStart = wordEnd + 1;
      continue;
    }

    if (lineCharCount + wordLen + (lineCharCount > 0 ? 1 : 0) > maxCharsPerLine) {
      currentLine++;
      lineCharCount = 0;
    }

    if (lineCharCount > 0) lineCharCount++;
    lineCharCount += wordLen;

    if (isNewline) {
      currentLine++;
      lineCharCount = 0;
    }

    wordStart = wordEnd + 1;
  }
  return currentLine + 1;
}

// Word wrapping helper for SSD1306 (with vertical scroll offset support)
void drawNoticeWordWrap(Adafruit_SSD1306 &disp, const String &text, int startX, int startY, int maxCharsPerLine, int scrollYPixels) {
  int currentLine = 0;
  int lineCharCount = 0;
  disp.setCursor(startX, startY + (currentLine * 9) - scrollYPixels);

  int len = text.length();
  int wordStart = 0;
  while (wordStart < len) {
    int nextSpace = text.indexOf(' ', wordStart);
    int nextNewline = text.indexOf('\n', wordStart);
    int wordEnd = len;
    bool isNewline = false;

    if (nextSpace != -1 && (nextNewline == -1 || nextSpace < nextNewline)) {
      wordEnd = nextSpace;
    } else if (nextNewline != -1) {
      wordEnd = nextNewline;
      isNewline = true;
    }

    String word = text.substring(wordStart, wordEnd);
    int wordLen = word.length();

    if (wordLen == 0 && isNewline) {
      currentLine++;
      lineCharCount = 0;
      disp.setCursor(startX, startY + (currentLine * 9) - scrollYPixels);
      wordStart = wordEnd + 1;
      continue;
    }

    if (lineCharCount + wordLen + (lineCharCount > 0 ? 1 : 0) > maxCharsPerLine) {
      currentLine++;
      lineCharCount = 0;
      disp.setCursor(startX, startY + (currentLine * 9) - scrollYPixels);
    }

    if (lineCharCount > 0) {
      disp.print(" ");
      lineCharCount++;
    }

    disp.print(word);
    lineCharCount += wordLen;

    if (isNewline) {
      currentLine++;
      lineCharCount = 0;
      disp.setCursor(startX, startY + (currentLine * 9) - scrollYPixels);
    }

    wordStart = wordEnd + 1;
  }
}

void updateNoticeBoardDisplay() {
  if (!noticeOledFound || !state_c1_notice_screen) return;
  unsigned long now = millis();

  cleanExpiredNotices();

  // --- NTP CLOCK SLIDE (Every 2 minutes = CLOCK_INTERVAL_MS) ---
  static unsigned long lastClockTriggerMs = 0;
  static bool isClockSlideActive = false;
  static unsigned long clockSlideStartMs = 0;

  // Initialize first timer baseline
  if (lastClockTriggerMs == 0) {
    lastClockTriggerMs = now;
  }

  // Trigger clock slide every 2 minutes
  if (!isClockSlideActive && (now - lastClockTriggerMs >= CLOCK_INTERVAL_MS)) {
    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 50)) {
      isClockSlideActive = true;
      clockSlideStartMs = now;
      lastClockTriggerMs = now;
    }
  }

  // Handle active Clock Slide
  if (isClockSlideActive) {
    if (now - clockSlideStartMs >= CLOCK_DISPLAY_DURATION_MS) {
      isClockSlideActive = false;
      // Clock slide completed: advance to the next notice so users see fresh content
      if (noticeCount > 1) {
        currentNoticeDisplayIndex = (currentNoticeDisplayIndex + 1) % noticeCount;
      }
      lastNoticeShownIndex = currentNoticeDisplayIndex;
      noticeActiveStartTimeMs = now;
    } else {
      static unsigned long lastClockDrawMs = 0;
      if (now - lastClockDrawMs < 200) return;
      lastClockDrawMs = now;

      struct tm timeinfo;
      if (getLocalTime(&timeinfo, 50)) {
        displayNotice.clearDisplay();
        displayNotice.setTextColor(SSD1306_WHITE);

        // 1. Date Header (Text size 1, centered)
        char dateBuf[26];
        strftime(dateBuf, sizeof(dateBuf), "%a, %d %b %Y", &timeinfo);
        int dateLen = strlen(dateBuf);
        int dateX = max(0, (128 - (dateLen * 6)) / 2);
        displayNotice.setTextSize(1);
        displayNotice.setCursor(dateX, 2);
        displayNotice.print(dateBuf);
        displayNotice.drawLine(0, 13, 128, 13, SSD1306_WHITE);

        // 2. Bigger and Bolder Time (Text size 2, double-strike for bold thickness)
        char timeBuf[12];
        strftime(timeBuf, sizeof(timeBuf), "%I:%M %p", &timeinfo);
        char *displayTime = timeBuf;
        if (displayTime[0] == '0') displayTime++;
        int timeLen = strlen(displayTime);
        int timeX = max(0, (128 - (timeLen * 12)) / 2);
        int timeY = 22;

        displayNotice.setTextSize(2);
        // Double-strike for prominent bold weight
        displayNotice.setCursor(timeX, timeY);
        displayNotice.print(displayTime);
        displayNotice.setCursor(timeX + 1, timeY);
        displayNotice.print(displayTime);

        // 3. Bottom Line: Clean divider & Label
        displayNotice.drawLine(0, 48, 128, 48, SSD1306_WHITE);
        displayNotice.setTextSize(1);
        displayNotice.setCursor(26, 53);
        displayNotice.print(F("CAMPUS CLOCK"));

        displayNotice.display();
        return;
      } else {
        isClockSlideActive = false;
      }
    }
  }

  // Priority: Period Over Alert Popup (10s duration)
  if (now < periodOverAlertUntilMs) {
    displayNotice.clearDisplay();
    displayNotice.fillRect(0, 0, 128, 14, SSD1306_WHITE);
    displayNotice.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
    displayNotice.setTextSize(1);
    displayNotice.setCursor(10, 3);
    displayNotice.print(F("*** PERIOD OVER ***"));

    displayNotice.setTextColor(SSD1306_WHITE);
    displayNotice.setCursor(0, 20);
    displayNotice.print(F("Ended:"));
    displayNotice.setCursor(0, 32);
    String pName = String(lastBellRungPeriodName);
    if (pName.length() > 21) pName = pName.substring(0, 18) + "...";
    displayNotice.print(pName);

    displayNotice.drawLine(0, 46, 128, 46, SSD1306_WHITE);
    displayNotice.setCursor(0, 52);
    displayNotice.printf("Time: %02d:%02d [BELL RUNG]", lastBellRungHour, lastBellRungMin);
    displayNotice.display();
    return;
  }

  // Find notices targeted to Classroom A101 (or "all")
  int eligibleIndices[MAX_FIRMWARE_NOTICES];
  int eligibleCount = 0;
  NoticeItemFirmware activeItem;
  bool hasActiveItem = false;

  if (lockNotices(pdMS_TO_TICKS(20))) {
    for (int i = 0; i < noticeCount; i++) {
      if (notices[i].active) {
        String cId = notices[i].classroomId;
        cId.toLowerCase();
        if (cId == "all" || cId.length() == 0 ||
            cId == "cls-a101" || cId == "a101" || cId == CLASSROOM_1_ID ||
            cId == "cls-a102" || cId == "a102" || cId == CLASSROOM_2_ID) {
          eligibleIndices[eligibleCount++] = i;
        }
      }
    }
    if (eligibleCount > 0) {
      if (currentNoticeDisplayIndex >= eligibleCount) {
        currentNoticeDisplayIndex = 0;
      }
      int activeNoticeIdx = eligibleIndices[currentNoticeDisplayIndex];
      activeItem = notices[activeNoticeIdx];
      hasActiveItem = true;
    }
    unlockNotices();
  }

  if (eligibleCount == 0 || !hasActiveItem) {
    static unsigned long lastStandbyRefresh = 0;
    if (now - lastStandbyRefresh < 500) return;
    lastStandbyRefresh = now;

    // Standby Display: Live Clock with Date & Standby status
    displayNotice.clearDisplay();
    displayNotice.setTextColor(SSD1306_WHITE);

    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 50)) {
      char dateBuf[26];
      strftime(dateBuf, sizeof(dateBuf), "%A, %d %b", &timeinfo);
      int dateLen = strlen(dateBuf);
      int dateX = max(0, (128 - (dateLen * 6)) / 2);
      displayNotice.setTextSize(1);
      displayNotice.setCursor(dateX, 2);
      displayNotice.print(dateBuf);
      displayNotice.drawLine(0, 13, 128, 13, SSD1306_WHITE);

      char timeBuf[12];
      strftime(timeBuf, sizeof(timeBuf), "%I:%M %p", &timeinfo);
      char *displayTime = timeBuf;
      if (displayTime[0] == '0') displayTime++;
      int timeLen = strlen(displayTime);
      int timeX = max(0, (128 - (timeLen * 12)) / 2);

      displayNotice.setTextSize(2);
      displayNotice.setCursor(timeX, 21);
      displayNotice.print(displayTime);
      displayNotice.setCursor(timeX + 1, 21);
      displayNotice.print(displayTime);

      displayNotice.drawLine(0, 47, 128, 47, SSD1306_WHITE);
      displayNotice.setTextSize(1);
      displayNotice.setCursor(12, 52);
      displayNotice.print(F("No Active Notices"));
    } else {
      displayNotice.setTextSize(1);
      displayNotice.setCursor(0, 12);
      displayNotice.println(F("DIGITAL NOTICE BOARD"));
      displayNotice.drawLine(0, 24, 128, 24, SSD1306_WHITE);
      displayNotice.setCursor(0, 36);
      displayNotice.println(F("  No Active Notices  "));
      displayNotice.setCursor(0, 48);
      displayNotice.println(F("   All caught up!    "));
    }
    displayNotice.display();
    return;
  }

  if (currentNoticeDisplayIndex >= eligibleCount) {
    currentNoticeDisplayIndex = 0;
  }

  // Detect when active notice switches (reset timer for reading top lines)
  if (currentNoticeDisplayIndex != lastNoticeShownIndex) {
    lastNoticeShownIndex = currentNoticeDisplayIndex;
    noticeActiveStartTimeMs = now;
  }

  NoticeItemFirmware &item = activeItem;

  // Calculate lines and scroll boundaries
  int totalLines = countNoticeLines(item.message, 21);
  int scrollY = 0;
  bool isScrolling = false;

  const unsigned long INITIAL_PAUSE_MS = 2500; // Pause 2.5s at top for initial reading
  const unsigned long SCROLL_SPEED_MS = 115;   // Slower vertical scroll (1 px every 115ms ~8.7 px/sec)
  const unsigned long END_PAUSE_MS = 2500;     // Pause 2.5s at bottom once finished before looping back

  unsigned long totalCycleMs = NOTICE_ROTATION_MS; // 20s rotation delay

  if (totalLines > 4) {
    int maxScrollY = (totalLines - 4) * 9 + 3;
    unsigned long scrollDurationMs = (unsigned long)maxScrollY * SCROLL_SPEED_MS;
    unsigned long oneScrollCycleMs = INITIAL_PAUSE_MS + scrollDurationMs + END_PAUSE_MS;
    
    // Ensure notice stays visible for at least 20s (or 1 full scroll cycle if longer)
    if (totalCycleMs < oneScrollCycleMs) totalCycleMs = oneScrollCycleMs;

    unsigned long elapsed = now - noticeActiveStartTimeMs;
    // Loop from the beginning once reached the bottom
    unsigned long cycleElapsed = elapsed % oneScrollCycleMs;
    if (cycleElapsed < INITIAL_PAUSE_MS) {
      scrollY = 0;
    } else if (cycleElapsed < INITIAL_PAUSE_MS + scrollDurationMs) {
      scrollY = (int)((cycleElapsed - INITIAL_PAUSE_MS) / SCROLL_SPEED_MS);
      if (scrollY > maxScrollY) scrollY = maxScrollY;
      isScrolling = true;
    } else {
      scrollY = maxScrollY;
    }
  }

  // Frame rate control: 50ms while scrolling for smooth animation, 250ms when static
  static unsigned long lastDisplayDrawMs = 0;
  unsigned long refreshThreshold = isScrolling ? 50 : 250;
  if (now - lastDisplayDrawMs < refreshThreshold) {
    return;
  }
  lastDisplayDrawMs = now;

  // Carousel transition: advance to next notice once full display/scroll cycle completes
  if (now - noticeActiveStartTimeMs >= totalCycleMs) {
    noticeActiveStartTimeMs = now;
    if (eligibleCount > 1) {
      currentNoticeDisplayIndex = (currentNoticeDisplayIndex + 1) % eligibleCount;
      lastNoticeShownIndex = currentNoticeDisplayIndex;
    }
  }

  // --- RENDER NOTICE WITH CLIPPING ---
  displayNotice.clearDisplay();
  displayNotice.setTextColor(SSD1306_WHITE);

  // 1. Draw message text with vertical scroll offset
  drawNoticeWordWrap(displayNotice, item.message, 0, 26, 21, scrollY);

  // 2. Viewport Mask: wipe y = 0..25 to black so scrolled lines cleanly pass under the header
  displayNotice.fillRect(0, 0, 128, 26, SSD1306_BLACK);

  // 3. Header Line (y=0..10): carousel counter if multiple notices
  displayNotice.setTextSize(1);
  displayNotice.setCursor(0, 0);
  if (eligibleCount > 1) {
    displayNotice.printf("[%d/%d] NOTICE", currentNoticeDisplayIndex + 1, eligibleCount);
  } else {
    displayNotice.print(F("NOTICE"));
  }
  displayNotice.drawLine(0, 10, 128, 10, SSD1306_WHITE);

  // 4. Title Line (y=14): bold title
  displayNotice.setCursor(0, 14);
  displayNotice.print(F("> "));
  String t = item.title;
  if (t.length() > 19) t = t.substring(0, 16) + "...";
  displayNotice.println(t);

  displayNotice.display();
}

// REST Handlers for Notices
void handleNoticePost() {
  enableCORS();
  String id = "";
  String clsId = "all";
  String title = "";
  String msg = "";
  String duration = "24h";

  if (server.hasArg("plain")) {
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (!err) {
      if (doc.containsKey("id")) id = doc["id"].as<String>();
      if (doc.containsKey("classroom_id")) clsId = doc["classroom_id"].as<String>();
      if (doc.containsKey("title")) title = doc["title"].as<String>();
      if (doc.containsKey("message")) msg = doc["message"].as<String>();
      if (doc.containsKey("duration")) duration = doc["duration"].as<String>();
    }
  }
  if (id.length() == 0 && server.hasArg("id")) id = server.arg("id");
  if (server.hasArg("classroom_id")) clsId = server.arg("classroom_id");
  if (title.length() == 0 && server.hasArg("title")) title = server.arg("title");
  if (msg.length() == 0 && server.hasArg("message")) msg = server.arg("message");
  if (server.hasArg("duration")) duration = server.arg("duration");

  if (title.length() == 0 || msg.length() == 0) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"title and message are required\"}");
    return;
  }
  if (id.length() == 0) {
    id = "notif-" + String(millis());
  }

  addOrUpdateNotice(id, clsId, title, msg, duration);
  server.send(200, "application/json", "{\"status\":\"ok\",\"id\":\"" + id + "\",\"count\":" + String(noticeCount) + "}");
}

void handleNoticeDelete() {
  enableCORS();
  String id = "";
  if (server.hasArg("plain")) {
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (!err && doc.containsKey("id")) {
      id = doc["id"].as<String>();
    }
  }
  if (id.length() == 0 && server.hasArg("id")) id = server.arg("id");

  if (id.length() == 0) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"id is required\"}");
    return;
  }

  bool deleted = deleteNoticeById(id);
  server.send(200, "application/json", "{\"status\":\"ok\",\"deleted\":" + String(deleted ? "true" : "false") + ",\"count\":" + String(noticeCount) + "}");
}

void handleNoticeGet() {
  enableCORS();
  cleanExpiredNotices();
  String json = "[";
  for (int i = 0; i < noticeCount; i++) {
    if (i > 0) json += ",";
    json += "{\"id\":\"" + notices[i].id + "\",";
    json += "\"classroom_id\":\"" + notices[i].classroomId + "\",";
    json += "\"title\":\"" + notices[i].title + "\",";
    json += "\"message\":\"" + notices[i].message + "\",";
    json += "\"duration\":\"" + notices[i].duration + "\",";
    json += "\"active\":" + String(notices[i].active ? "true" : "false") + "}";
  }
  json += "]";
  server.send(200, "application/json", json);
}

void handleNoticesSync() {
  enableCORS();
  if (server.hasArg("plain")) {
    StaticJsonDocument<4096> doc;
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (!err && doc.is<JsonArray>()) {
      noticeCount = 0; // Replace with incoming active array
      newNoticePopupUntilMs = 0;
      for (JsonObject obj : doc.as<JsonArray>()) {
        const char* id = obj["id"];
        const char* cls = obj["classroom_id"];
        const char* t = obj["title"];
        const char* m = obj["message"];
        const char* d = obj["duration"];
        if (id && t && m && noticeCount < MAX_FIRMWARE_NOTICES) {
          notices[noticeCount].id = String(id);
          notices[noticeCount].classroomId = cls ? String(cls) : "all";
          notices[noticeCount].title = String(t);
          notices[noticeCount].message = String(m);
          notices[noticeCount].duration = d ? String(d) : "24h";

          String durStr = notices[noticeCount].duration;
          durStr.toLowerCase();
          if (durStr == "1h") notices[noticeCount].durationMs = 3600000UL;
          else if (durStr == "24h" || durStr == "1d") notices[noticeCount].durationMs = 86400000UL;
          else notices[noticeCount].durationMs = 0;

          notices[noticeCount].createdAtMs = millis();
          notices[noticeCount].active = true;
          noticeCount++;
        }
      }
      if (currentNoticeDisplayIndex >= noticeCount) {
        currentNoticeDisplayIndex = 0;
      }
      if (singleOledNoticeIdx >= noticeCount) {
        singleOledNoticeIdx = 0;
      }
      saveNoticesToNVS();
      Serial.printf("[NOTICE SYNC] Active notices synchronized (%d active).\n", noticeCount);
      server.send(200, "application/json", "{\"status\":\"ok\",\"count\":" + String(noticeCount) + "}");
      return;
    }
  }
  server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid JSON array\"}");
}

// REST Handler for Manual Time Sync (from phone app fallback)
void handleTimeSync() {
  enableCORS();
  time_t epoch = 0;
  if (server.hasArg("epoch")) {
    epoch = (time_t)server.arg("epoch").toInt();
  } else if (server.hasArg("plain")) {
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (!err && doc.containsKey("epoch")) {
      epoch = (time_t)doc["epoch"].as<long>();
    }
  }

  if (epoch > 1700000000) {
    time_t current = time(nullptr);
    if (abs((long)(current - epoch)) > 3) {
      struct timeval tv;
      tv.tv_sec = epoch;
      tv.tv_usec = 0;
      settimeofday(&tv, NULL);
      Serial.printf("[TIME] Manually synchronized epoch: %ld\n", (long)epoch);
    }
    server.send(200, "application/json", "{\"status\":\"ok\",\"synced_epoch\":" + String((long)epoch) + "}");
    return;
  }
  server.send(400, "application/json", "{\"error\":\"invalid epoch\"}");
}

// REST Handler to Test 3V Audio Buzzer
void handleBuzzerTest() {
  enableCORS();
  lastLocalBellTriggerMs = millis();
  if (server.hasArg("pattern")) {
    String pat = server.arg("pattern");
    playBellPattern(pat.c_str());
    server.send(200, "application/json", "{\"status\":\"ok\",\"pattern\":\"" + pat + "\"}");
  } else {
    triggerNoticeBeep();
    server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Buzzer alert beep triggered\"}");
  }
}

void handleBell() {
  enableCORS();
  lastLocalBellTriggerMs = millis();
  String pat = timetableDefaultPattern;
  if (server.hasArg("pattern")) {
    pat = server.arg("pattern");
  }
  playBellPattern(pat.c_str());
  server.send(200, "application/json", "{\"status\":\"ok\",\"pattern\":\"" + pat + "\"}");
}

void handleTimetableGet() {
  enableCORS();
  StaticJsonDocument<4096> doc;
  doc["enabled"] = timetableEnabled;
  doc["defaultPattern"] = timetableDefaultPattern;

  JsonArray days = doc.createNestedArray("activeDays");
  for (int d = 0; d <= 6; d++) {
    if (timetableActiveDays & (1 << d)) {
      days.add(d);
    }
  }

  JsonArray periods = doc.createNestedArray("periods");
  for (int i = 0; i < timetablePeriodCount; i++) {
    JsonObject p = periods.createNestedObject();
    p["id"] = timetablePeriods[i].id;
    p["name"] = timetablePeriods[i].name;
    p["type"] = timetablePeriods[i].type;
    p["enabled"] = timetablePeriods[i].enabled;
    p["bellPattern"] = timetablePeriods[i].pattern;
    if (timetablePeriods[i].days != 0) {
      JsonArray dArr = p.createNestedArray("days");
      for (int d = 0; d <= 6; d++) {
        if (timetablePeriods[i].days & (1 << d)) {
          dArr.add(d);
        }
      }
    }

    char buf[8];
    snprintf(buf, sizeof(buf), "%02d:%02d", timetablePeriods[i].startHour, timetablePeriods[i].startMin);
    p["startTime"] = buf;
    snprintf(buf, sizeof(buf), "%02d:%02d", timetablePeriods[i].endHour, timetablePeriods[i].endMin);
    p["endTime"] = buf;
  }

  String output;
  serializeJson(doc, output);
  server.send(200, "application/json", output);
}

void handleTimetablePost() {
  enableCORS();
  if (server.hasArg("plain")) {
    String body = server.arg("plain");
    if (parseTimetableJson(body)) {
      saveTimetableToNVS(body);
      server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Timetable saved to NVS\"}");
      return;
    }
  }
  server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
}

// ==========================================
// --- REST API: 24/7 DEVICE SCHEDULES ---
// ==========================================
void handleScheduleGet() {
  enableCORS();
  if (server.hasArg("id") || server.hasArg("dev")) {
    String id = server.hasArg("id") ? server.arg("id") : server.arg("dev");
    int idx = getDeviceScheduleIndex(id);
    if (idx >= 0) {
      FirmwareDeviceSchedule &s = deviceSchedules[idx];
      StaticJsonDocument<512> doc;
      doc["id"] = s.primaryId;
      doc["dev"] = s.devCode;
      doc["enabled"] = s.enabled;
      char onBuf[6], offBuf[6];
      if (s.onHour >= 0 && s.onMin >= 0) snprintf(onBuf, sizeof(onBuf), "%02d:%02d", s.onHour, s.onMin); else strcpy(onBuf, "");
      if (s.offHour >= 0 && s.offMin >= 0) snprintf(offBuf, sizeof(offBuf), "%02d:%02d", s.offHour, s.offMin); else strcpy(offBuf, "");
      doc["onTime"] = onBuf;
      doc["offTime"] = offBuf;
      JsonArray dArr = doc.createNestedArray("days");
      for (int d = 0; d < 7; d++) {
        if (s.days & (1 << d)) dArr.add(d);
      }
      doc["autoOffEnabled"] = s.autoOffEnabled;
      doc["autoOffMinutes"] = s.autoOffMinutes;
      String out;
      serializeJson(doc, out);
      server.send(200, "application/json", out);
      return;
    }
    server.send(404, "application/json", "{\"error\":\"device not found\"}");
    return;
  }

  // Return all device schedules
  StaticJsonDocument<3072> doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < NUM_SCHEDULED_DEVICES; i++) {
    FirmwareDeviceSchedule &s = deviceSchedules[i];
    JsonObject o = arr.createNestedObject();
    o["id"] = s.primaryId;
    o["dev"] = s.devCode;
    o["enabled"] = s.enabled;
    char onBuf[6], offBuf[6];
    if (s.onHour >= 0 && s.onMin >= 0) snprintf(onBuf, sizeof(onBuf), "%02d:%02d", s.onHour, s.onMin); else strcpy(onBuf, "");
    if (s.offHour >= 0 && s.offMin >= 0) snprintf(offBuf, sizeof(offBuf), "%02d:%02d", s.offHour, s.offMin); else strcpy(offBuf, "");
    o["onTime"] = onBuf;
    o["offTime"] = offBuf;
    JsonArray dArr = o.createNestedArray("days");
    for (int d = 0; d < 7; d++) {
      if (s.days & (1 << d)) dArr.add(d);
    }
    o["autoOffEnabled"] = s.autoOffEnabled;
    o["autoOffMinutes"] = s.autoOffMinutes;
  }
  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handleSchedulePost() {
  enableCORS();
  if (!server.hasArg("plain") && !server.hasArg("id")) {
    server.send(400, "application/json", "{\"error\":\"Missing body or query parameters\"}");
    return;
  }

  String targetId = "";
  StaticJsonDocument<1024> doc;

  if (server.hasArg("plain")) {
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (err) {
      server.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
      return;
    }
    if (doc.containsKey("id")) {
      targetId = doc["id"].as<String>();
    }
  }
  if (targetId.length() == 0 && server.hasArg("id")) {
    targetId = server.arg("id");
  }

  int idx = getDeviceScheduleIndex(targetId);
  if (idx < 0) {
    server.send(404, "application/json", "{\"error\":\"Device ID not recognized\"}");
    return;
  }

  JsonVariantConst schedObj = doc.containsKey("schedule") ? doc["schedule"].as<JsonVariantConst>() : doc.as<JsonVariantConst>();
  if (parseDeviceSchedule(idx, schedObj)) {
    String serialized;
    serializeJson(schedObj, serialized);
    saveDeviceScheduleToNVS(idx, serialized);
    Serial.printf("[SCHEDULE REST] Updated & saved schedule for %s: %s\n", targetId.c_str(), serialized.c_str());
    server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Schedule saved and activated\"}");
  } else {
    server.send(400, "application/json", "{\"error\":\"Failed to parse schedule\"}");
  }
}

// ==========================================
// --- REST API: ROOT ---
// ==========================================
void handleRoot() {
  enableCORS();
  if (isApSetupMode) {
    handleWiFiPortal();
    return;
  }
  server.send(200, "application/json",
              "{\"system\":\"NBA Smart Classroom Controller\",\"firmware\":\"" +
                  String(FIRMWARE_VERSION) + "\",\"status\":\"online\",\"ssid\":\"" +
                  String(WiFi.SSID()) + "\"}");
}

// Forward declaration for FreeRTOS background cloud task
void supabaseCloudTask(void *pvParameters);

// ==========================================
// --- STANDALONE SETUP HOTSPOT (AP MODE) ---
// ==========================================
void startSetupHotspot() {
  if (isApSetupMode) return;
  isApSetupMode = true;
  Serial.println(F("\n[SETUP] Initializing Standalone Setup Hotspot..."));

  // 1. Completely disconnect & shut off STA mode to stop radio channel-hopping
  WiFi.disconnect(true, true);
  delay(150);

  // 2. Set pure Access Point mode (WIFI_AP) so beacons are solid and stable
  WiFi.mode(WIFI_AP);
  delay(100);

  // 3. Explicitly configure AP IP & start DHCP server on 192.168.4.1
  IPAddress apIP(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);
  WiFi.softAPConfig(apIP, gateway, subnet);

  // 4. Start SoftAP with NULL password for open network
  const char *apPass = (SETUP_AP_PASSWORD && strlen(SETUP_AP_PASSWORD) >= 8) ? SETUP_AP_PASSWORD : NULL;
  bool ok = WiFi.softAP(SETUP_AP_SSID, apPass, 1, 0, 4);

  if (ok) {
    Serial.printf("[SETUP] Setup Hotspot ACTIVE: '%s'\n", SETUP_AP_SSID);
    Serial.printf("[SETUP] Web Configuration Portal: http://%s\n", WiFi.softAPIP().toString().c_str());
  } else {
    Serial.println(F("[ERROR] Failed to start SoftAP! Retrying..."));
    delay(200);
    WiFi.softAP(SETUP_AP_SSID, apPass);
  }

  // 5. Start Captive Portal DNS Server (redirects all DNS queries to 192.168.4.1)
  dnsServer.stop();
  dnsServer.start(DNS_PORT, "*", apIP);
  Serial.println(F("[SETUP] Captive Portal DNS Server active on port 53"));

  // 6. Update Primary OLED with setup instructions
  if (oledFound) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(F("[WIFI SETUP MODE]"));
    display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
    display.setCursor(0, 14);
    display.println(F("Hotspot Active:"));
    display.setCursor(0, 26);
    display.println(SETUP_AP_SSID);
    display.setCursor(0, 40);
    display.println(F("Connect & Open:"));
    display.setCursor(0, 52);
    display.println(F("http://192.168.4.1"));
    display.display();
  }
}

// ==========================================
// --- FISAT DEPARTMENT BOOT ANIMATION ---
// Adapted from Lopaka screen layout for Adafruit SSD1306
// ==========================================
void drawScreen_1(Adafruit_SSD1306 &disp, int progressPercent = -1) {
  disp.clearDisplay();
  disp.setTextColor(SSD1306_WHITE);

  // String 1: "FISAT" (Large, Bold Heading - Height 24px)
  disp.setTextSize(3);
  disp.setCursor(19, 6);
  disp.print(F("FISAT"));

  // Subtle separator line under FISAT
  disp.drawLine(14, 34, 114, 34, SSD1306_WHITE);

  // String 2: "DEPARTMENT OF"
  disp.setTextSize(1);
  disp.setCursor(26, 38);
  disp.print(F("DEPARTMENT OF"));

  // String 2 Copy 1: "COMPUTER APPLICATIONS"
  disp.setCursor(2, 50);
  disp.print(F("COMPUTER APPLICATIONS"));

  // Optional Smooth Boot Progress Bar at bottom (y=61..63)
  if (progressPercent >= 0) {
    disp.drawRect(14, 61, 100, 3, SSD1306_WHITE);
    int barWidth = map(constrain(progressPercent, 0, 100), 0, 100, 0, 98);
    if (barWidth > 0) {
      disp.fillRect(15, 62, barWidth, 1, SSD1306_WHITE);
    }
  }
  disp.display();
}

void playBootAnimation() {
  if (!oledFound && !noticeOledFound) return;

  Serial.println(F("[BOOT] Playing FISAT boot animation on dual displays..."));

  // Stage 1: Animated center accent line expanding outward
  for (int w = 4; w <= 100; w += 16) {
    if (oledFound) {
      display.clearDisplay();
      display.drawLine(64 - w / 2, 34, 64 + w / 2, 34, SSD1306_WHITE);
      display.display();
    }
    if (noticeOledFound) {
      displayNotice.clearDisplay();
      displayNotice.drawLine(64 - w / 2, 34, 64 + w / 2, 34, SSD1306_WHITE);
      displayNotice.display();
    }
    delay(25);
  }

  // Stage 2: Smooth loading progress bar revealing full FISAT Department banner
  for (int p = 0; p <= 100; p += 10) {
    if (oledFound) drawScreen_1(display, p);
    if (noticeOledFound) drawScreen_1(displayNotice, p);
    delay(45);
  }

  // Stage 4: Hold complete branding screen for 2.0 seconds so it is clearly visible
  if (oledFound) drawScreen_1(display, 100);
  if (noticeOledFound) drawScreen_1(displayNotice, 100);
  delay(2000);
}

// ==========================================
// --- SETUP INITIALIZATION ---
// ==========================================
void setup() {
  // 0. Disable Hardware Brownout Detector so momentary coil/servo inrush
  // currents don't cause CPU reset
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n=============================================="));
  Serial.println(F(" NBA SMART CLASSROOM - DUAL ZONE CONTROLLER"));
  Serial.printf(F(" Firmware Version: %s\n"), FIRMWARE_VERSION);
  Serial.println(F("=============================================="));

  // Initialize FreeRTOS Concurrency Mutexes
  if (!noticeMutex) noticeMutex = xSemaphoreCreateMutex();
  if (!nvsMutex) nvsMutex = xSemaphoreCreateMutex();

  // Initialize NVS Preferences to restore persistent system mode & energy
  // across boots
  preferences.begin("nba_scr", false);
  isAutoMode = preferences.getBool("auto_mode", false);
  c1_accumulated_kwh = preferences.getFloat("c1_kwh", 0.0f);
  c2_accumulated_kwh = preferences.getFloat("c2_kwh", 0.0f);
  rated_c1_light = preferences.getFloat("r_c1_l", WATTS_CLASS_LIGHT);
  rated_c1_fan = preferences.getFloat("r_c1_f", WATTS_CLASS_FAN);
  rated_c2_light = preferences.getFloat("r_c2_l", WATTS_CLASS_LIGHT);
  rated_c2_fan = preferences.getFloat("r_c2_f", WATTS_CLASS_FAN);
  rated_corr1 = preferences.getFloat("r_cr1", WATTS_CORR_LIGHT);
  rated_corr2 = preferences.getFloat("r_cr2", WATTS_CORR_LIGHT);
  rated_ws2812 = preferences.getFloat("r_ws2812", WATTS_WS2812_STRIP);
  loadNoticesFromNVS(); // Immediately restore notices onto Notice OLED on boot
  loadTimetableFromNVS(); // Restore timetable schedule from NVS flash memory
  loadDeviceSchedulesFromNVS(); // Restore 24/7 autonomous device schedules from NVS flash memory
  cloud_prev_system_auto = isAutoMode;
  Serial.printf("[SYSTEM] Boot System Mode: %s | Restored Energy: C1=%.4f kWh, "
                "C2=%.4f kWh\n",
                isAutoMode ? "AUTO" : "MANUAL", (float)c1_accumulated_kwh,
                (float)c2_accumulated_kwh);

  // Sync NTP Time (IST +5:30) using config.h parameters
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER_1, NTP_SERVER_2, NTP_SERVER_3);

  // 1. Initialize Sensor Pins
  dht.begin();
  pinMode(PIR1_PIN, INPUT_PULLDOWN);
  pinMode(PIR2_PIN, INPUT_PULLDOWN);
  pinMode(LDR_CORRIDOR1_PIN, INPUT);
  pinMode(LDR_CORRIDOR2_PIN, INPUT);
  pinMode(ACS712_CURRENT_PIN, INPUT);
  pinMode(ZMPT101B_VOLTAGE_PIN, INPUT);

  // 1b. Initialize 3V Audio Alert Buzzer
#if defined(BUZZER_PIN) && BUZZER_PIN >= 0
  digitalWrite(BUZZER_PIN, LOW);
  pinMode(BUZZER_PIN, OUTPUT);
  silenceBuzzer();
  Serial.printf("[HARDWARE] 3V Alert Buzzer initialized on GPIO %d (Type: %s)\n", 
                BUZZER_PIN, BUZZER_IS_ACTIVE ? "ACTIVE" : "PASSIVE");
#endif

  // 2. Initialize Relay Output Pins
  // Set output registers to RELAY_OFF BEFORE setting pinMode to OUTPUT!
  // This completely eliminates the momentary active-LOW power-on relay click/flash during boot.
  digitalWrite(RELAY_CLASS_LIGHT1, RELAY_OFF);
  digitalWrite(RELAY_CLASS_FAN1, RELAY_OFF);
  digitalWrite(RELAY_CLASS_LIGHT2, RELAY_OFF);
  digitalWrite(RELAY_CLASS_FAN2, RELAY_OFF);
  digitalWrite(RELAY_CORRIDOR_LIGHT1, RELAY_OFF);
  digitalWrite(RELAY_CORRIDOR_LIGHT2, RELAY_OFF);

  pinMode(RELAY_CLASS_LIGHT1, OUTPUT);
  pinMode(RELAY_CLASS_FAN1, OUTPUT);
  pinMode(RELAY_CLASS_LIGHT2, OUTPUT);
  pinMode(RELAY_CLASS_FAN2, OUTPUT);
  pinMode(RELAY_CORRIDOR_LIGHT1, OUTPUT);
  pinMode(RELAY_CORRIDOR_LIGHT2, OUTPUT);
  applyRelayStates();

  // 2b. Initialize WS2812B Addressable LED Strip (15 LEDs, GPIO 5)
  strip.begin();
  strip.setBrightness(ws2812_brightness);
  strip.clear();
  strip.show();
  Serial.printf("[HARDWARE] WS2812B LED Strip initialized on GPIO %d (%d LEDs)\n", WS2812_PIN, WS2812_NUM_LEDS);

  // 3. Initialize Servos (Closed position)
  curtain1.setPeriodHertz(50);
  curtain2.setPeriodHertz(50);
  curtain1.attach(SERVO1_PIN);
  curtain2.attach(SERVO2_PIN);
  curtain1.write(SERVO_CLOSED_ANGLE);
  curtain2.write(SERVO_CLOSED_ANGLE);
  delay(400);
  curtain1.detach();
  curtain2.detach();

  // 4A. Initialize Primary I2C OLED Display (System & Telemetry on Wire: GPIO 21/22)
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  Wire.setClock(400000); // Fast 400kHz I2C to eliminate display loop latency
  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    oledFound = true;
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println(F("NBA Smart Classroom"));
    display.println(F("Dual Controller"));
    display.println(F("---------------------"));
    display.println(F("Connecting Wi-Fi..."));
    display.display();
  } else {
    Serial.println(
        F("[WARN] Telemetry OLED SSD1306 allocation failed (check GPIO 21/22)"));
  }

  // 4B. Initialize Secondary I2C OLED Display (Classroom Notice Board on Wire1: GPIO 13/15)
  I2C_Notice.begin(NOTICE_OLED_SDA_PIN, NOTICE_OLED_SCL_PIN);
  I2C_Notice.setClock(400000); // Fast 400kHz I2C
  if (displayNotice.begin(SSD1306_SWITCHCAPVCC, NOTICE_OLED_I2C_ADDR)) {
    noticeOledFound = true;
    displayNotice.clearDisplay();
    displayNotice.setTextSize(1);
    displayNotice.setTextColor(SSD1306_WHITE);
    displayNotice.setCursor(0, 16);
    displayNotice.println(F("DIGITAL NOTICE BOARD"));
    displayNotice.drawLine(0, 28, 128, 28, SSD1306_WHITE);
    displayNotice.setCursor(0, 38);
    displayNotice.println(F("   Initializing...   "));
    displayNotice.display();
    Serial.println(F("[OK] Notice Board OLED initialized on Wire1 (GPIO 13/15)"));
  } else {
    Serial.println(
        F("[WARN] Notice Board OLED SSD1306 allocation failed on Wire1 (GPIO 13/15)"));
  }

  // 4C. Play FISAT Department Boot Animation on Both Displays Simultaneously
  playBootAnimation();

  // 5. Connect to Wi-Fi (Load from NVS Preferences or fallback to config.h defaults)
  configured_ssid = preferences.getString("wifi_ssid", DEFAULT_WIFI_SSID);
  configured_pass = preferences.getString("wifi_pass", DEFAULT_WIFI_PASSWORD);

  Serial.printf("\n[WIFI] Attempting connection to SSID: %s\n", configured_ssid.c_str());
  if (oledFound) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(F("NBA Smart Classroom"));
    display.println(F("Connecting to:"));
    display.println(configured_ssid);
    display.println(F("Please wait..."));
    display.display();
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(configured_ssid.c_str(), configured_pass.c_str());

  unsigned long startWifi = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startWifi < (unsigned long)(WIFI_CONNECT_TIMEOUT_SEC * 1000)) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F("\n[OK] Wi-Fi Connected!"));
    Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
    isApSetupMode = false;
    pendingIpCloudSync = true;
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER_1, NTP_SERVER_2, NTP_SERVER_3);
    Serial.println(F("[NTP] Initialized NTP time sync with pool servers"));

    // 6. Start mDNS Responder (http://esp32-classroom.local)
    if (MDNS.begin(HOSTNAME)) {
      Serial.printf("mDNS Responder live at: http://%s.local\n", HOSTNAME);
      MDNS.addService("http", "tcp", WEB_SERVER_PORT);
    }
  } else {
    Serial.printf("\n[WARN] Connection to '%s' failed/timed out.\n", configured_ssid.c_str());
    startSetupHotspot();
  }

  // 7. Update OLED with IP / Setup instructions
  if (oledFound) {
    display.clearDisplay();
    display.setCursor(0, 0);
    if (!isApSetupMode && WiFi.status() == WL_CONNECTED) {
      display.println(F("NBA IoT Controller"));
      display.println(F("---------------------"));
      display.println(F("Wi-Fi: Connected"));
      display.println(configured_ssid);
      display.println(WiFi.localIP());
      display.display();
      delay(2000);
    } else {
      display.println(F("[WIFI SETUP MODE]"));
      display.println(F("---------------------"));
      display.println(F("Hotspot:"));
      display.println(SETUP_AP_SSID);
      display.println(F("Open in Browser:"));
      display.println(F("192.168.4.1"));
      display.display();
      delay(3000);
    }
  }

  // 8. Register REST API Handlers (App JSON Interface & Web Portal)
  server.on("/", HTTP_GET, handleRoot);
  server.on("/wifi", HTTP_GET, handleWiFiPortal);
  server.on("/savewifi", HTTP_POST, handleSaveWiFi);
  server.on("/api/wifi", HTTP_ANY, handleApiWiFi);
  server.on("/api/wifi/scan", HTTP_GET, handleApiWiFiScan);
  server.on("/api/wifi/reset", HTTP_ANY, handleResetWiFi);
  server.on("/status", HTTP_ANY, handleStatus);     // Status endpoint for App
  server.on("/status", HTTP_OPTIONS, handleOptions);
  server.on("/api/status", HTTP_ANY, handleStatus); // Enhanced REST status
  server.on("/api/status", HTTP_OPTIONS, handleOptions);
  server.on("/mode", HTTP_ANY, handleMode);         // Mode toggle
  server.on("/mode", HTTP_OPTIONS, handleOptions);
  server.on("/api/mode", HTTP_ANY, handleMode);
  server.on("/api/mode", HTTP_OPTIONS, handleOptions);
  server.on("/ctrl", HTTP_ANY, handleControl); // Device control
  server.on("/ctrl", HTTP_OPTIONS, handleOptions);
  server.on("/api/control", HTTP_ANY, handleControl);
  server.on("/api/control", HTTP_OPTIONS, handleOptions);
  server.on("/config", HTTP_ANY, handleConfig); // Threshold adjustments
  server.on("/config", HTTP_OPTIONS, handleOptions);
  server.on("/api/config", HTTP_ANY, handleConfig);
  server.on("/api/config", HTTP_OPTIONS, handleOptions);
  server.on("/api/notice", HTTP_POST, handleNoticePost);
  server.on("/api/notice", HTTP_GET, handleNoticeGet);
  server.on("/api/notices", HTTP_GET, handleNoticeGet);
  server.on("/api/notice", HTTP_OPTIONS, handleOptions);
  server.on("/api/notices", HTTP_OPTIONS, handleOptions);
  server.on("/api/notices/sync", HTTP_ANY, handleNoticesSync);
  server.on("/api/notices/sync", HTTP_OPTIONS, handleOptions);
  server.on("/api/notice/sync", HTTP_ANY, handleNoticesSync);
  server.on("/api/notice/sync", HTTP_OPTIONS, handleOptions);
  server.on("/api/notice/delete", HTTP_ANY, handleNoticeDelete);
  server.on("/api/notice/delete", HTTP_OPTIONS, handleOptions);
  server.on("/api/time", HTTP_ANY, handleTimeSync);
  server.on("/api/buzzer", HTTP_ANY, handleBuzzerTest);
  server.on("/api/buzzer", HTTP_OPTIONS, handleOptions);
  server.on("/api/bell", HTTP_ANY, handleBell);
  server.on("/api/bell", HTTP_OPTIONS, handleOptions);
  server.on("/api/timetable", HTTP_GET, handleTimetableGet);
  server.on("/api/timetable", HTTP_POST, handleTimetablePost);
  server.on("/api/timetable", HTTP_OPTIONS, handleOptions);
  server.on("/api/schedule", HTTP_GET, handleScheduleGet);
  server.on("/api/schedule", HTTP_POST, handleSchedulePost);
  server.on("/api/schedule", HTTP_OPTIONS, handleOptions);
  server.on("/api/schedules", HTTP_GET, handleScheduleGet);
  server.on("/api/schedules", HTTP_POST, handleSchedulePost);
  server.on("/api/schedules", HTTP_OPTIONS, handleOptions);
  server.on("/api/rgb", HTTP_ANY, handleApiRgb);
  server.on("/api/rgb", HTTP_OPTIONS, handleOptions);
  server.on("/ctrl/rgb", HTTP_ANY, handleApiRgb);
  server.on("/ctrl/rgb", HTTP_OPTIONS, handleOptions);

  server.onNotFound(handleNotFound); // Captive portal redirect & CORS preflight
  server.begin();
  Serial.println(F("[OK] HTTP API Server Started"));

  // 9. Launch Supabase Cloud Task on Core 0 (Background)
  // 16KB stack space ensures safe mbedTLS execution without stack overflow
  xTaskCreatePinnedToCore(supabaseCloudTask, "SupabaseCloudTask", 16384, NULL,
                          1, NULL, 0);
  Serial.println(F("[OK] Supabase Cloud Background Task started on Core 0"));

  // 10. Play Startup Chord Arpeggio
  playBootChime();

  // 11. Connect to Supabase Realtime WebSocket for sub-50ms instant remote control
  if (WiFi.status() == WL_CONNECTED) {
    initSupabaseRealtimeWS();
  }
}

// ==========================================
// --- SUPABASE REALTIME WEBSOCKET CLIENT ---
// ==========================================
// Persistent low-latency push socket via Phoenix Channels over WSS.
// Delivers sub-50ms instant device actuation when mobile app is on cellular data!
WebSocketsClient wsClient;
bool wsConnected = false;
unsigned long lastWsHeartbeat = 0;

void handleRealtimeWsMessage(const char *data, size_t len) {
  if (len <= 0) return;

  // Pre-filter: only process Phoenix broadcast messages
  if (strstr(data, "\"broadcast\"") == NULL) return;

  static DynamicJsonDocument doc(4096);
  doc.clear();
  DeserializationError err = deserializeJson(doc, data, len);
  if (err) return;

  const char *ev = doc["event"];
  if (!ev || strcmp(ev, "broadcast") != 0) return;

  JsonObject pWrapper = doc["payload"];
  if (!pWrapper.containsKey("payload") || !pWrapper["payload"].is<JsonObject>()) return;

  JsonObject p = pWrapper["payload"];
  const char *dev = p["dev"];
  if (!dev) return;

  int st = p["st"] | 0;

  Serial.printf("[REALTIME WS] Instant push command: dev='%s', st=%d\n", dev, st);

  // 1. Instant RTC clock sync from any incoming packet timestamp
  if (p.containsKey("t")) {
    unsigned long long tMs = p["t"].as<unsigned long long>();
    time_t epoch = (time_t)(tMs / 1000ULL);
    if (epoch > 1700000000) {
      time_t current = time(nullptr);
      if (abs((long)(current - epoch)) > 3) {
        struct timeval tv = { .tv_sec = epoch, .tv_usec = 0 };
        settimeofday(&tv, NULL);
        Serial.printf("[TIME] Synced RTC clock from WS packet timestamp: %ld\n", (long)epoch);
      }
    }
  }

  // 2. Direct time synchronization command
  if (strcmp(dev, "time") == 0) {
    if (p.containsKey("epoch")) {
      time_t epoch = (time_t)p["epoch"].as<long>();
      if (epoch > 1700000000) {
        struct timeval tv = { .tv_sec = epoch, .tv_usec = 0 };
        settimeofday(&tv, NULL);
        Serial.printf("[TIME] Synced RTC clock from WS direct time sync: %ld\n", (long)epoch);
      }
    }
    return;
  }

  // 3. Digital Notice Board Announcement push (<50ms display + audio chime over mobile data)
  if (strcmp(dev, "notice") == 0) {
    const char *nid = p["id"];
    const char *ncls = p["classroom_id"] | "all";
    const char *ntitle = p["title"];
    const char *nmsg = p["message"];
    const char *ndur = p["duration"] | "24h";
    if (ntitle && nmsg) {
      String idStr = nid ? String(nid) : ("ws-" + String(millis()));
      addOrUpdateNotice(idStr, String(ncls), String(ntitle), String(nmsg), String(ndur), true, true);
      Serial.printf("[NOTICE] WS push announcement displayed: '%s'\n", ntitle);
    }
    return;
  }

  // 4. Digital Notice Board Announcement deletion
  if (strcmp(dev, "notice_del") == 0) {
    const char *nid = p["id"];
    if (nid) {
      deleteNoticeById(String(nid));
      Serial.printf("[NOTICE] WS push announcement deleted: %s\n", nid);
    }
    return;
  }

  // 5. Device Power Schedule instant sync
  if (strcmp(dev, "sched") == 0) {
    if (p.containsKey("id") && p.containsKey("schedule")) {
      const char *devId = p["id"];
      int sIdx = getDeviceScheduleIndex(String(devId));
      if (sIdx >= 0) {
        String serialized;
        serializeJson(p["schedule"], serialized);
        parseDeviceSchedule(sIdx, p["schedule"]);
        saveDeviceScheduleToNVS(sIdx, serialized);
        Serial.printf("[SCHEDULE] WS push: updated & saved schedule for %s: %s\n", devId, serialized.c_str());
      }
    }
    return;
  }

  // 6. Timetable & Bell Schedule instant sync
  if (strcmp(dev, "tt") == 0) {
    if (p.containsKey("timetable")) {
      String ttStr;
      if (p["timetable"].is<JsonObject>() || p["timetable"].is<JsonArray>()) {
        serializeJson(p["timetable"], ttStr);
      } else {
        ttStr = p["timetable"].as<String>();
      }
      if (ttStr.length() > 10) {
        if (parseTimetableJson(ttStr)) {
          saveTimetableToNVS(ttStr);
          Serial.printf("[TIMETABLE] WS push: updated & saved %d periods to NVS!\n", timetablePeriodCount);
        }
      }
    }
    return;
  }

  if (strcmp(dev, "bell") == 0) {
    lastLocalBellTriggerMs = millis();
    if (p.containsKey("ts") && !p["ts"].isNull()) {
      lastExecutedBellTs = p["ts"].as<String>();
    } else if (p.containsKey("t") && !p["t"].isNull()) {
      lastExecutedBellTs = String((unsigned long long)p["t"].as<unsigned long long>());
    }
    const char *pat = p["pattern"] | "westminster";
    playBellPattern(pat);
    return;
  }

  if (strcmp(dev, "mode") == 0) {
    setSystemModeInternal(st == 1, true);
    return;
  }

  // Any manual device command received via WebSocket switches ESP32 to manual mode
  if (isAutoMode) {
    setSystemModeInternal(false, true);
    Serial.printf("[SYSTEM] WS manual command '%s' -> Switched to MANUAL Mode\n", dev);
  }

  if (strcmp(dev, "all") == 0 || strcmp(dev, "emergency") == 0) {
    applyDeviceControl("all", false);
    return;
  }

  if (strcmp(dev, "rgb") == 0) {
    lastWs2812LocalChange = millis();
    if (p.containsKey("color")) {
      const char *c = p["color"];
      if (c && strlen(c) > 0) ws2812_color = String(c);
    }
    if (p.containsKey("b")) {
      int b = p["b"].as<int>();
      ws2812_brightness = map(constrain(b, 0, 100), 0, 100, 0, 255);
    } else if (p.containsKey("brightness")) {
      int b = p["brightness"].as<int>();
      ws2812_brightness = map(constrain(b, 0, 100), 0, 100, 0, 255);
    }
    if (p.containsKey("mode")) {
      const char *m = p["mode"];
      if (m && strlen(m) > 0) {
        ws2812_mode = String(m);
        last_ws2812_anim_ms = 0;
      }
    } else if (p.containsKey("rgbMode")) {
      const char *m = p["rgbMode"];
      if (m && strlen(m) > 0) {
        ws2812_mode = String(m);
        last_ws2812_anim_ms = 0;
      }
    }
    applyDeviceControl("rgb", st == 1);
    return;
  }

  applyDeviceControl(String(dev), st == 1);
}

void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println(F("[REALTIME WS] Disconnected from Supabase Realtime"));
      break;

    case WStype_CONNECTED: {
      wsConnected = true;
      Serial.println(F("[REALTIME WS] Connected to Supabase Realtime!"));
      // Join Phoenix broadcast channel "device_control"
      const char *joinMsg = "{\"topic\":\"realtime:device_control\",\"event\":\"phx_join\",\"payload\":{\"config\":{\"broadcast\":{\"ack\":false,\"self\":false}}},\"ref\":\"1\"}";
      wsClient.sendTXT(joinMsg);
      Serial.println(F("[REALTIME WS] Sent phx_join for realtime:device_control"));
      lastWsHeartbeat = millis();
      break;
    }

    case WStype_TEXT: {
      if (length > 0 && payload != NULL) {
        handleRealtimeWsMessage((const char *)payload, length);
      }
      break;
    }

    case WStype_ERROR:
      Serial.println(F("[REALTIME WS] WebSocket error event"));
      break;

    default:
      break;
  }
}

void initSupabaseRealtimeWS() {
  String host = String(SUPABASE_URL);
  if (host.startsWith("https://")) host = host.substring(8);
  else if (host.startsWith("http://")) host = host.substring(7);
  int slashIdx = host.indexOf('/');
  if (slashIdx >= 0) host = host.substring(0, slashIdx);

  String path = "/realtime/v1/websocket?apikey=" + String(SUPABASE_KEY) + "&vsn=1.0.0";

  wsClient.beginSSL(host.c_str(), 443, path.c_str());
  wsClient.onEvent(webSocketEvent);
  wsClient.setReconnectInterval(4000);
  wsClient.enableHeartbeat(15000, 3000, 2);
  Serial.printf("[REALTIME WS] Initialized WebSocket client to wss://%s:443\n", host.c_str());
}

// ==========================================
// --- SUPABASE CLOUD SYNCHRONIZATION ---
// ==========================================
unsigned long lastSupabasePoll = 0;
unsigned long lastSupabaseTelemetry = 0;
bool supabaseSyncActive = false;

// --- HTTP Date Header Clock Synchronization ---
// Extracts UTC timestamp from RFC 1123 HTTP Date header ("Date: Fri, 02 Oct 2026 17:19:39 GMT")
// Guarantees atomic hardware RTC synchronization across mobile data and firewalled school networks even if NTP UDP is blocked!
void syncTimeFromHttpDateHeader(const String &dateStr) {
  if (dateStr.length() < 25) return;
  int commaIdx = dateStr.indexOf(',');
  if (commaIdx < 0) return;
  String rest = dateStr.substring(commaIdx + 1);
  rest.trim(); // "02 Oct 2026 17:19:39 GMT"

  int d = rest.substring(0, 2).toInt();
  String mStr = rest.substring(3, 6);
  int y = rest.substring(7, 11).toInt();
  int h = rest.substring(12, 14).toInt();
  int mi = rest.substring(15, 17).toInt();
  int s = rest.substring(18, 20).toInt();

  const char *months[] = {"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"};
  int m = -1;
  for (int i = 0; i < 12; i++) {
    if (mStr.equalsIgnoreCase(months[i])) { m = i; break; }
  }
  if (m < 0 || y < 2024 || d < 1 || d > 31) return;

  static const int daysBeforeMonth[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
  int leaps = (y - 1969) / 4 - (y - 1901) / 100 + (y - 1601) / 400;
  bool isLeap = ((y % 4 == 0) && (y % 100 != 0)) || (y % 400 == 0);
  int days = (y - 1970) * 365 + leaps + daysBeforeMonth[m] + (d - 1);
  if (isLeap && m > 1) days++;
  time_t epoch = (time_t)days * 86400L + (time_t)h * 3600L + (time_t)mi * 60L + s;

  if (epoch > 1700000000) {
    time_t cur = time(nullptr);
    if (abs((long)(cur - epoch)) > 3) {
      struct timeval tv = { .tv_sec = epoch, .tv_usec = 0 };
      settimeofday(&tv, NULL);
      Serial.printf("[TIME] Synced RTC clock from HTTP Date header: %ld (%04d-%02d-%02d %02d:%02d:%02d UTC)\n",
                    (long)epoch, y, m + 1, d, h, mi, s);
    }
  }
}

void syncWithSupabase() {
  if (WiFi.status() != WL_CONNECTED)
    return;
  unsigned long now = millis();

  // 0A. Immediate Controller Heartbeat & Live IP sync on boot or Wi-Fi reconnect
  if (pendingIpCloudSync) {
    WiFiClientSecure ipClient;
    ipClient.setInsecure();
    ipClient.setTimeout(4000);
    HTTPClient ipHttps;
    ipHttps.setTimeout(4000);
    String urlCtrl =
        String(SUPABASE_URL) + "/rest/v1/controllers?id=eq.ctrl-esp32";
    if (ipHttps.begin(ipClient, urlCtrl)) {
      ipHttps.addHeader("apikey", SUPABASE_KEY);
      ipHttps.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      ipHttps.addHeader("Content-Type", "application/json");
      ipHttps.addHeader("Prefer", "return=minimal");

      int rssi = WiFi.RSSI();
      String sig = (rssi > -60) ? "strong" : (rssi > -75) ? "medium" : "weak";
      String body = "{\"status\":\"online\",\"signal_strength\":\"" + sig +
                    "\",\"ip_address\":\"" + WiFi.localIP().toString() +
                    "\",\"firmware_version\":\"" + String(FIRMWARE_VERSION) +
                    "\"}";
      int httpRes = ipHttps.sendRequest("PATCH", body);
      if (httpRes >= 200 && httpRes < 300) {
        pendingIpCloudSync = false;
        Serial.printf("[SUPABASE] Live IP %s successfully pushed to Cloud (HTTP %d)\n",
                      WiFi.localIP().toString().c_str(), httpRes);
      } else {
        Serial.printf(
            "[SUPABASE WARN] Live IP sync failed (HTTP %d). Will retry.\n",
            httpRes);
      }
      ipHttps.end();
      ipClient.stop();
    }
    lastSupabasePoll = now;
    return;
  }

  // 0B. Sync System Mode to Cloud if changed locally (with retry on failure)
  if (pendingModeCloudSync) {
    WiFiClientSecure mClient;
    mClient.setInsecure();
    mClient.setTimeout(4000);
    HTTPClient mHttps;
    mHttps.setTimeout(4000);
    String urlMode =
        String(SUPABASE_URL) + "/rest/v1/devices?id=eq.dev-system-mode";
    if (mHttps.begin(mClient, urlMode)) {
      mHttps.addHeader("apikey", SUPABASE_KEY);
      mHttps.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      mHttps.addHeader("Content-Type", "application/json");
      mHttps.addHeader("Prefer", "return=minimal");
      String body =
          "{\"status\":\"" + String(isAutoMode ? "auto" : "manual") + "\"}";
      int httpRes = mHttps.sendRequest("PATCH", body);
      if (httpRes >= 200 && httpRes < 300) {
        pendingModeCloudSync = false;
        cloud_prev_system_auto = isAutoMode;
        Serial.printf("[SUPABASE] Successfully synced system mode '%s' to "
                      "cloud (HTTP %d)\n",
                      isAutoMode ? "auto" : "manual", httpRes);
      } else {
        Serial.printf(
            "[SUPABASE WARN] System mode sync failed (HTTP %d). Retrying.\n",
            httpRes);
      }
      mHttps.end();
      mClient.stop();
    }
    lastSupabasePoll =
        now; // Delay next GET poll slightly so Supabase DB commit settles
    return;
  }

  // 0C. Sync Scheduled Device States to Cloud (if triggered autonomously by hardware RTC timer)
  if (pendingDeviceCloudSyncMask != 0) {
    for (int i = 0; i < NUM_SCHEDULED_DEVICES; i++) {
      if (pendingDeviceCloudSyncMask & (1 << i)) {
        portENTER_CRITICAL(&syncMaskMux);
        pendingDeviceCloudSyncMask &= ~(1 << i);
        portEXIT_CRITICAL(&syncMaskMux);
        const char* devId = deviceSchedules[i].primaryId;
        bool isOn = getDeviceCurrentState(deviceSchedules[i].devCode);

        WiFiClientSecure dClient;
        dClient.setInsecure();
        dClient.setTimeout(3000);
        HTTPClient dHttps;
        dHttps.setTimeout(3000);
        String urlDev = String(SUPABASE_URL) + "/rest/v1/devices?id=eq." + String(devId);
        if (dHttps.begin(dClient, urlDev)) {
          dHttps.addHeader("apikey", SUPABASE_KEY);
          dHttps.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
          dHttps.addHeader("Content-Type", "application/json");
          dHttps.addHeader("Prefer", "return=minimal");
          String body = "{\"status\":\"" + String(isOn ? "on" : "off") + "\"}";
          int res = dHttps.sendRequest("PATCH", body);
          Serial.printf("[SCHEDULE CLOUD SYNC] Synced %s -> %s to cloud (HTTP %d)\n", devId, isOn ? "ON" : "OFF", res);
          dHttps.end();
          dClient.stop();
        }
        break; // Sync one device per cycle to avoid blocking
      }
    }
    lastSupabasePoll = now;
    return;
  }

  // 1. Fetch Remote Device Commands from Supabase (Every 2500ms fallback, or 10000ms when WebSocket is healthy)
  unsigned long effectivePollInterval = wsConnected ? 10000UL : SUPABASE_POLL_INTERVAL_MS;
  if (now - lastSupabasePoll >= effectivePollInterval) {
    lastSupabasePoll = now;

    WiFiClientSecure client;
    client.setInsecure(); // Supabase HTTPS
    client.setTimeout(2500); // 2.5s socket timeout (prevents blocking local Wi-Fi server)

    HTTPClient https;
    https.setTimeout(2500);
    const char *headerKeys[] = {"Date"};
    https.collectHeaders(headerKeys, 1);
    String url = String(SUPABASE_URL) + "/rest/v1/devices?select=id,status,settings";
    if (https.begin(client, url)) {
      https.addHeader("apikey", SUPABASE_KEY);
      https.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      https.addHeader("Accept", "application/json");

      int httpCode = https.GET();
      if (httpCode == 200) {
        if (https.hasHeader("Date")) {
          syncTimeFromHttpDateHeader(https.header("Date"));
        }
        supabaseSyncActive = true;
        String payload = https.getString();

        static DynamicJsonDocument doc(12288);
        doc.clear();
        DeserializationError err = deserializeJson(doc, payload);
        if (err) {
          Serial.printf("[SUPABASE] JSON Deserialization error: %s (payload bytes: %d)\n", err.c_str(), payload.length());
        } else if (doc.is<JsonArray>()) {
          bool anyStateChanged = false;
          for (JsonObject dev : doc.as<JsonArray>()) {
            const char *id = dev["id"];
            const char *st = dev["status"];
            if (!id || !st)
              continue;

            // Check for onboard schedule in settings JSONB
            if (dev.containsKey("settings") && dev["settings"].is<JsonObject>()) {
              JsonObject s = dev["settings"];
              if (s.containsKey("schedule") && s["schedule"].is<JsonObject>()) {
                int sIdx = getDeviceScheduleIndex(String(id));
                if (sIdx >= 0) {
                  String serialized;
                  serializeJson(s["schedule"], serialized);
                  String existing = "";
                  if (lockNVS()) {
                    existing = preferences.getString(deviceSchedules[sIdx].nvsKey, "");
                    unlockNVS();
                  }
                  if (serialized != existing) {
                    parseDeviceSchedule(sIdx, s["schedule"]);
                    saveDeviceScheduleToNVS(sIdx, serialized);
                    Serial.printf("[SCHEDULE] Cloud sync: updated & saved schedule for %s: %s\n", id, serialized.c_str());
                  }
                }
              }
            }

            // 1. System Mode command from Cloud (with anti-echo shield)
            if (strcmp(id, "dev-system-mode") == 0) {
              bool cloudAuto = (strcmp(st, "auto") == 0);

              // Check for cloud bell test trigger in settings JSONB
              if (dev.containsKey("settings") && dev["settings"].is<JsonObject>()) {
                JsonObject s = dev["settings"];
                if (s.containsKey("bell_trigger") && s["bell_trigger"].is<JsonObject>()) {
                  JsonObject bt = s["bell_trigger"];
                  String ts = "";
                  if (bt.containsKey("ts") && !bt["ts"].isNull()) {
                    ts = bt["ts"].as<String>();
                  } else if (bt.containsKey("timestamp") && !bt["timestamp"].isNull()) {
                    ts = bt["timestamp"].as<String>();
                  }
                  if (ts.length() > 0 && ts != "null" && ts != "0") {
                    if (!bellBootLatch) {
                      // First poll after boot: latch existing timestamp so we don't ring old/stale triggers!
                      lastExecutedBellTs = ts;
                      bellBootLatch = true;
                      Serial.printf("[CLOUD BELL] Startup trigger latched: %s\n", ts.c_str());
                    } else if (ts != lastExecutedBellTs) {
                      lastExecutedBellTs = ts;
                      if ((now - lastLocalBellTriggerMs < 12000) || (chimeNoteIndex >= 0)) {
                        Serial.printf("[CLOUD BELL] Echo suppressed: bell already played/playing (%lu ms ago)\n", now - lastLocalBellTriggerMs);
                      } else {
                        const char* pat = bt["pattern"] | "westminster";
                        Serial.printf("[CLOUD BELL] Triggered via Supabase! Pattern: %s, ts: %s\n", pat, ts.c_str());
                        playBellPattern(pat);
                      }
                    }
                  }
                }

                // Check for cloud timetable configuration in settings JSONB
                if (s.containsKey("timetable") && (s["timetable"].is<JsonObject>() || s["timetable"].is<String>())) {
                  static String lastSyncedTimetableStr = "";
                  String currentTtStr;
                  if (s["timetable"].is<JsonObject>()) {
                    serializeJson(s["timetable"], currentTtStr);
                  } else {
                    currentTtStr = s["timetable"].as<String>();
                  }
                  if (currentTtStr.length() > 10 && currentTtStr != lastSyncedTimetableStr) {
                    lastSyncedTimetableStr = currentTtStr;
                    if (parseTimetableJson(currentTtStr)) {
                      saveTimetableToNVS(currentTtStr);
                      Serial.printf("[TIMETABLE] Synced & saved %d periods from Cloud Supabase!\n", timetablePeriodCount);
                    }
                  }
                }
              }

              // Anti-echo protection: Ignore cloud command for 15 seconds after
              // a local change
              if (now - lastLocalModeChange < 15000) {
                continue;
              }

              if (!cloud_initialized) {
                cloud_prev_system_auto = cloudAuto;
                // If boot NVS preference differs from cloud, enforce local NVS
                // over stale cloud!
                if (cloudAuto != isAutoMode) {
                  pendingModeCloudSync = true;
                  lastLocalModeChange = now;
                  Serial.printf("[SYSTEM] Pushing persistent NVS mode '%s' to "
                                "replace stale cloud '%s'\n",
                                isAutoMode ? "AUTO" : "MANUAL",
                                cloudAuto ? "AUTO" : "MANUAL");
                }
              } else if (cloudAuto != cloud_prev_system_auto) {
                cloud_prev_system_auto = cloudAuto;
                setSystemModeInternal(cloudAuto, false);
                Serial.printf("[SYSTEM] Mode changed via Cloud -> %s\n",
                              isAutoMode ? "AUTO" : "MANUAL");
              }
              continue;
            }

            bool isOn = (strcmp(st, "on") == 0);

            // On first boot, record baseline cloud states without triggering
            // actions
            if (!cloud_initialized) {
              if (strcmp(id, "dev-a101-light-1") == 0 ||
                  strcmp(id, "dev-a101-light") == 0)
                cloud_prev_c1_light = isOn;
              else if (strcmp(id, "dev-a101-fan-1") == 0 ||
                       strcmp(id, "dev-a101-fan") == 0)
                cloud_prev_c1_fan = isOn;
              else if (strcmp(id, "dev-a101-curtain") == 0)
                cloud_prev_c1_curtain = isOn;
              else if (strcmp(id, "dev-a102-light-1") == 0 ||
                       strcmp(id, "dev-a102-light") == 0)
                cloud_prev_c2_light = isOn;
              else if (strcmp(id, "dev-a102-fan-1") == 0 ||
                       strcmp(id, "dev-a102-fan") == 0)
                cloud_prev_c2_fan = isOn;
              else if (strcmp(id, "dev-a102-curtain") == 0)
                cloud_prev_c2_curtain = isOn;
              else if (strcmp(id, "dev-corr-light-1") == 0 ||
                       strcmp(id, "dev-corr-light1") == 0)
                cloud_prev_corr1_light = isOn;
              else if (strcmp(id, "dev-corr-light-2") == 0 ||
                       strcmp(id, "dev-corr-light2") == 0)
                cloud_prev_corr2_light = isOn;
              else if (strcmp(id, "dev-corr-rgb-strip") == 0) {
                cloud_prev_ws2812 = isOn;
                state_ws2812 = isOn;
                if (dev.containsKey("settings")) {
                  JsonObject s = dev["settings"];
                  if (s.containsKey("color")) ws2812_color = s["color"].as<String>();
                  if (s.containsKey("brightness")) {
                    int b = s["brightness"].as<int>();
                    ws2812_brightness = map(constrain(b, 0, 100), 0, 100, 0, 255);
                  }
                  if (s.containsKey("rgbMode")) ws2812_mode = s["rgbMode"].as<String>();
                  else if (s.containsKey("mode")) ws2812_mode = s["mode"].as<String>();
                }
                ws2812_needs_update = true;
              }
              else if (strcmp(id, "dev-a101-notice-board") == 0 ||
                       strcmp(id, "dev-a101-notice") == 0) {
                cloud_prev_c1_notice_board = isOn;
                if (!isOn) setNoticeScreenPower(false);
              }
              else if (strcmp(id, "dev-a101-smart-screen") == 0 ||
                       strcmp(id, "dev-a101-smart") == 0 ||
                       strcmp(id, "dev-a101-screen") == 0) {
                cloud_prev_c1_smart_screen = isOn;
                if (!isOn) setSmartScreenPower(false);
              }
              continue;
            }

            // Check anti-echo shield for this device:
            // If controlled locally within the last 12 seconds, stale cloud GET responses must NOT override it!
            int dIdx = getDeviceScheduleIndex(String(id));
            if (dIdx >= 0 && (now - lastLocalDeviceControlMs[dIdx] < 12000)) {
              // Maintain baseline in sync with local state so future polls don't fight
              bool curSt = getDeviceCurrentState(deviceSchedules[dIdx].devCode);
              if (dIdx == 0) cloud_prev_c1_light = curSt;
              else if (dIdx == 1) cloud_prev_c1_fan = curSt;
              else if (dIdx == 2) cloud_prev_c1_curtain = curSt;
              else if (dIdx == 3) cloud_prev_c1_notice_board = curSt;
              else if (dIdx == 4) cloud_prev_c1_smart_screen = curSt;
              else if (dIdx == 5) cloud_prev_c2_light = curSt;
              else if (dIdx == 6) cloud_prev_c2_fan = curSt;
              else if (dIdx == 7) cloud_prev_c2_curtain = curSt;
              else if (dIdx == 8) cloud_prev_corr1_light = curSt;
              else if (dIdx == 9) cloud_prev_corr2_light = curSt;
              else if (dIdx == 10) {
                cloud_prev_ws2812 = curSt;
                isOn = curSt; // Shield power state from stale cloud echo, but let color/brightness/mode settings process below!
              }
              if (dIdx != 10) continue;
            }

            // Differential Tracking:
            // CRITICAL: When isAutoMode == true, the local sensors have
            // exclusive authority over relay states. Device polling only
            // updates baseline tracking; it NEVER overrides local sensor relays
            // and NEVER disarms Auto Mode! When in Manual Mode (!isAutoMode),
            // incoming cloud changes actuate relays.
            if (!isAutoMode) {
              if (strcmp(id, "dev-a101-light-1") == 0 ||
                  strcmp(id, "dev-a101-light") == 0) {
                if (isOn != cloud_prev_c1_light) {
                  cloud_prev_c1_light = isOn;
                  state_c1_light = isOn;
                  anyStateChanged = true;
                  Serial.printf("[MANUAL COMMAND] A101 Light -> %s\n",
                                isOn ? "ON" : "OFF");
                }
              } else if (strcmp(id, "dev-a101-fan-1") == 0 ||
                         strcmp(id, "dev-a101-fan") == 0) {
                if (isOn != cloud_prev_c1_fan) {
                  cloud_prev_c1_fan = isOn;
                  state_c1_fan = isOn;
                  anyStateChanged = true;
                  Serial.printf("[MANUAL COMMAND] A101 Fan -> %s\n",
                                isOn ? "ON" : "OFF");
                }
              } else if (strcmp(id, "dev-a101-curtain") == 0) {
                if (isOn != cloud_prev_c1_curtain) {
                  cloud_prev_c1_curtain = isOn;
                  state_c1_curtain = isOn;
                  anyStateChanged = true;
                  Serial.printf("[MANUAL COMMAND] A101 Curtain -> %s\n",
                                isOn ? "OPEN" : "CLOSED");
                }
              } else if (strcmp(id, "dev-a102-light-1") == 0 ||
                         strcmp(id, "dev-a102-light") == 0) {
                if (isOn != cloud_prev_c2_light) {
                  cloud_prev_c2_light = isOn;
                  state_c2_light = isOn;
                  anyStateChanged = true;
                  Serial.printf("[MANUAL COMMAND] A102 Light -> %s\n",
                                isOn ? "ON" : "OFF");
                }
              } else if (strcmp(id, "dev-a102-fan-1") == 0 ||
                         strcmp(id, "dev-a102-fan") == 0) {
                if (isOn != cloud_prev_c2_fan) {
                  cloud_prev_c2_fan = isOn;
                  state_c2_fan = isOn;
                  anyStateChanged = true;
                  Serial.printf("[MANUAL COMMAND] A102 Fan -> %s\n",
                                isOn ? "ON" : "OFF");
                }
              } else if (strcmp(id, "dev-a102-curtain") == 0) {
                if (isOn != cloud_prev_c2_curtain) {
                  cloud_prev_c2_curtain = isOn;
                  state_c2_curtain = isOn;
                  anyStateChanged = true;
                  Serial.printf("[MANUAL COMMAND] A102 Curtain -> %s\n",
                                isOn ? "OPEN" : "CLOSED");
                }
              } else if (strcmp(id, "dev-corr-light-1") == 0 ||
                         strcmp(id, "dev-corr-light1") == 0) {
                if (isOn != cloud_prev_corr1_light) {
                  cloud_prev_corr1_light = isOn;
                  state_corr1_light = isOn;
                  anyStateChanged = true;
                  Serial.printf("[MANUAL COMMAND] Corridor 1 Light -> %s\n",
                                isOn ? "ON" : "OFF");
                }
              } else if (strcmp(id, "dev-corr-light-2") == 0 ||
                         strcmp(id, "dev-corr-light2") == 0) {
                if (isOn != cloud_prev_corr2_light) {
                  cloud_prev_corr2_light = isOn;
                  state_corr2_light = isOn;
                  anyStateChanged = true;
                  Serial.printf("[MANUAL COMMAND] Corridor 2 Light -> %s\n",
                                isOn ? "ON" : "OFF");
                }
              }
            } else {
              // In Auto Mode: keep baseline in sync so switching to Manual
              // later has no stale echo
              if (strcmp(id, "dev-a101-light-1") == 0 ||
                  strcmp(id, "dev-a101-light") == 0)
                cloud_prev_c1_light = isOn;
              else if (strcmp(id, "dev-a101-fan-1") == 0 ||
                       strcmp(id, "dev-a101-fan") == 0)
                cloud_prev_c1_fan = isOn;
              else if (strcmp(id, "dev-a101-curtain") == 0)
                cloud_prev_c1_curtain = isOn;
              else if (strcmp(id, "dev-a102-light-1") == 0 ||
                       strcmp(id, "dev-a102-light") == 0)
                cloud_prev_c2_light = isOn;
              else if (strcmp(id, "dev-a102-fan-1") == 0 ||
                       strcmp(id, "dev-a102-fan") == 0)
                cloud_prev_c2_fan = isOn;
              else if (strcmp(id, "dev-a102-curtain") == 0)
                cloud_prev_c2_curtain = isOn;
              else if (strcmp(id, "dev-corr-light-1") == 0 ||
                       strcmp(id, "dev-corr-light1") == 0)
                cloud_prev_corr1_light = isOn;
              else if (strcmp(id, "dev-corr-light-2") == 0 ||
                       strcmp(id, "dev-corr-light2") == 0)
                cloud_prev_corr2_light = isOn;
            }

            // Display Controls (Work in both Auto & Manual Mode)
            if (strcmp(id, "dev-a101-notice-board") == 0 ||
                strcmp(id, "dev-a101-notice") == 0) {
              if (isOn != cloud_prev_c1_notice_board) {
                cloud_prev_c1_notice_board = isOn;
                setNoticeScreenPower(isOn);
                Serial.printf("[CLOUD COMMAND] A101 Notice Board -> %s\n", isOn ? "ON" : "OFF");
              }
            } else if (strcmp(id, "dev-a101-smart-screen") == 0 ||
                       strcmp(id, "dev-a101-smart") == 0 ||
                       strcmp(id, "dev-a101-screen") == 0) {
              if (isOn != cloud_prev_c1_smart_screen) {
                cloud_prev_c1_smart_screen = isOn;
                setSmartScreenPower(isOn);
                Serial.printf("[CLOUD COMMAND] A101 Smart Screen -> %s\n", isOn ? "ON" : "OFF");
              }
            } else if (strcmp(id, "dev-corr-rgb-strip") == 0 ||
                       strcmp(id, "dev-corr-rgb") == 0) {
              bool stateChanged = (isOn != cloud_prev_ws2812);
              bool colorChanged = false;
              if (dev.containsKey("settings")) {
                JsonObject s = dev["settings"];
                if (s.containsKey("color")) {
                  String newColor = s["color"].as<String>();
                  if (newColor.length() > 0 && newColor != ws2812_color) {
                    if (millis() - lastWs2812LocalChange < 6000) {
                      // Suppress stale cloud poll echo for recently commanded local color
                    } else {
                      ws2812_color = newColor;
                      colorChanged = true;
                    }
                  }
                }
                if (s.containsKey("brightness")) {
                  int b = s["brightness"].as<int>();
                  int newB = map(constrain(b, 0, 100), 0, 100, 0, 255);
                  if (newB != ws2812_brightness) {
                    if (millis() - lastWs2812LocalChange < 6000) {
                      // Suppress stale cloud poll echo for recently commanded local brightness
                    } else {
                      ws2812_brightness = newB;
                      colorChanged = true;
                    }
                  }
                }
                String newMode = "";
                if (s.containsKey("rgbMode")) newMode = s["rgbMode"].as<String>();
                else if (s.containsKey("mode")) newMode = s["mode"].as<String>();

                if (newMode.length() > 0 && newMode != ws2812_mode) {
                  if (millis() - lastWs2812LocalChange < 6000) {
                    Serial.printf("[WS2812] Cloud poll echo suppressed: recent command set mode '%s' %lu ms ago (cloud had '%s')\n",
                                  ws2812_mode.c_str(), millis() - lastWs2812LocalChange, newMode.c_str());
                  } else {
                    ws2812_mode = newMode;
                    last_ws2812_anim_ms = 0;
                    colorChanged = true;
                  }
                }
              }
              if (stateChanged || (colorChanged && isOn)) {
                cloud_prev_ws2812 = isOn;
                state_ws2812 = isOn;
                ws2812_needs_update = true;
                Serial.printf("[CLOUD COMMAND] Corridor RGB Strip -> %s (Color: %s, Mode: %s, B: %d)\n",
                              isOn ? "ON" : "OFF", ws2812_color.c_str(), ws2812_mode.c_str(), ws2812_brightness);
              } else if (colorChanged && !isOn) {
                // Settings updated while strip is OFF: save color/mode/brightness silently without turning strip ON!
                cloud_prev_ws2812 = false;
                state_ws2812 = false;
              }
            }
          }

          if (!cloud_initialized)
            cloud_initialized = true;

          if (anyStateChanged) {
            // Relays will be safely actuated by Core 1 loop() without multi-core static re-entrancy
          }
        }
      } else {
        supabaseSyncActive = false;
        lastSupabasePoll = millis() + 3000; // Backoff 3 seconds on failure so Wi-Fi stack doesn't choke
        static unsigned long lastErr = 0;
        if (millis() - lastErr > 6000) {
          Serial.printf("[SUPABASE ERROR] GET devices HTTP %d: %s\n", httpCode,
                        https.errorToString(httpCode).c_str());
          lastErr = millis();
        }
      }
      https.end();
      client.stop();
    }
    return;
  }

  // 2. Push Sensor & Occupancy Telemetry to Supabase (Independent cycle)
  if (now - lastSupabaseTelemetry >= SUPABASE_TELEMETRY_INTERVAL_MS) {
    lastSupabaseTelemetry = now;
    static int telemetryStep = 0;

    WiFiClientSecure client;
    client.setInsecure();
    client.setTimeout(2500);
    HTTPClient https;
    https.setTimeout(2500);

    if (telemetryStep == 0) {
      // Slot 0: Classroom A101 Telemetry
      String urlA101 =
          String(SUPABASE_URL) + "/rest/v1/classrooms?id=eq.cls-a101";
      if (https.begin(client, urlA101)) {
        https.addHeader("apikey", SUPABASE_KEY);
        https.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
        https.addHeader("Content-Type", "application/json");
        https.addHeader("Prefer", "return=minimal");

        String body =
            "{\"temperature\":" + String(currentTemp, 1) +
            ",\"occupancy_status\":\"" +
            String(c1_occupied ? "occupied" : "vacant") +
            "\",\"current_load\":" + String(getC1LoadWatts(), 1) +
            ",\"energy_today\":" + String(c1_accumulated_kwh, 4) +
            ",\"estimated_cost\":" + String(c1_accumulated_kwh * 8.0, 2) +
            ",\"status\":\"online\"}";
        https.sendRequest("PATCH", body);
        https.end();
        client.stop();
      }
    } else if (telemetryStep == 1) {
      // Slot 1: Classroom A102 Telemetry
      String urlA102 =
          String(SUPABASE_URL) + "/rest/v1/classrooms?id=eq.cls-a102";
      if (https.begin(client, urlA102)) {
        https.addHeader("apikey", SUPABASE_KEY);
        https.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
        https.addHeader("Content-Type", "application/json");
        https.addHeader("Prefer", "return=minimal");

        String body =
            "{\"temperature\":" + String(currentTemp, 1) +
            ",\"occupancy_status\":\"" +
            String(c2_occupied ? "occupied" : "vacant") +
            "\",\"current_load\":" + String(getC2LoadWatts(), 1) +
            ",\"energy_today\":" + String(c2_accumulated_kwh, 4) +
            ",\"estimated_cost\":" + String(c2_accumulated_kwh * 8.0, 2) +
            ",\"status\":\"online\"}";
        https.sendRequest("PATCH", body);
        https.end();
        client.stop();
      }
    } else if (telemetryStep == 2) {
      // Slot 2: Corridors Telemetry
      String urlCorr =
          String(SUPABASE_URL) + "/rest/v1/classrooms?id=eq.cls-corridor";
      if (https.begin(client, urlCorr)) {
        https.addHeader("apikey", SUPABASE_KEY);
        https.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
        https.addHeader("Content-Type", "application/json");
        https.addHeader("Prefer", "return=minimal");

        String body = "{\"current_load\":" + String(getCorrLoadWatts(), 1) +
                      ",\"status\":\"online\"}";
        https.sendRequest("PATCH", body);
        https.end();
        client.stop();
      }
    } else if (telemetryStep == 3) {
      // Slot 3: Controller Heartbeat & Live IP
      String urlCtrl =
          String(SUPABASE_URL) + "/rest/v1/controllers?id=eq.ctrl-esp32";
      if (https.begin(client, urlCtrl)) {
        https.addHeader("apikey", SUPABASE_KEY);
        https.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
        https.addHeader("Content-Type", "application/json");
        https.addHeader("Prefer", "return=minimal");

        int rssi = WiFi.RSSI();
        String sig = (rssi > -60) ? "strong" : (rssi > -75) ? "medium" : "weak";
        String body = "{\"status\":\"online\",\"signal_strength\":\"" + sig +
                      "\",\"ip_address\":\"" + WiFi.localIP().toString() +
                      "\",\"firmware_version\":\"" + String(FIRMWARE_VERSION) +
                      "\"}";
        https.sendRequest("PATCH", body);
        https.end();
        client.stop();
      }
    } else {
      // Slot 4: Cloud Digital Notice Board Announcements
      // Reads dedicated active, non-expired announcements from Supabase with lean projection
      String urlAnn = String(SUPABASE_URL) + "/rest/v1/announcements?select=id,classroom_id,title,message,duration&is_active=eq.true&or=%28expires_at.is.null,expires_at.gt.now%28%29%29&order=created_at.desc&limit=6";
      const char *annHeaderKeys[] = {"Date"};
      https.collectHeaders(annHeaderKeys, 1);
      if (https.begin(client, urlAnn)) {
        https.addHeader("apikey", SUPABASE_KEY);
        https.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
        https.addHeader("Accept", "application/json");

        int code = https.GET();
        if (code == 200) {
          if (https.hasHeader("Date")) {
            syncTimeFromHttpDateHeader(https.header("Date"));
          }
          String payload = https.getString();
          static DynamicJsonDocument doc(4096);
          doc.clear();
          DeserializationError err = deserializeJson(doc, payload);
          if (!err && doc.is<JsonArray>()) {
            reconcileNoticesFromCloud(doc.as<JsonArray>());
          }
        }
        https.end();
        client.stop();
      }
    }

    telemetryStep = (telemetryStep + 1) % 5;
    return;
  }
}

static bool initialCloudNoticeSyncDone = false;

void reconcileNoticesFromCloud(JsonArray cloudNotices) {
  NoticeItemFirmware updated[MAX_FIRMWARE_NOTICES];
  int updatedCount = 0;

  for (JsonObject a : cloudNotices) {
    const char* aid = a["id"];
    const char* cid = a["classroom_id"];
    const char* atitle = a["title"];
    const char* amsg = a["message"];
    const char* adur = a["duration"];
    String dur = (adur && strlen(adur) > 0) ? String(adur) : "24h";

    if (aid && atitle && amsg && updatedCount < MAX_FIRMWARE_NOTICES) {
      updated[updatedCount].id = String(aid);
      updated[updatedCount].classroomId = cid ? String(cid) : "all";
      updated[updatedCount].title = String(atitle);
      updated[updatedCount].message = String(amsg);
      updated[updatedCount].duration = dur;
      String durStr = dur;
      durStr.toLowerCase();
      if (durStr == "1h") updated[updatedCount].durationMs = 3600000UL;
      else if (durStr == "24h" || durStr == "1d") updated[updatedCount].durationMs = 86400000UL;
      else updated[updatedCount].durationMs = 0;

      // Preserve existing createdAtMs if notice was already active to allow natural expiration
      unsigned long origCreatedAt = millis();
      if (lockNotices()) {
        for (int k = 0; k < noticeCount; k++) {
          if (notices[k].id == String(aid)) {
            origCreatedAt = notices[k].createdAtMs;
            break;
          }
        }
        unlockNotices();
      }
      updated[updatedCount].createdAtMs = origCreatedAt;
      updated[updatedCount].active = true;
      updatedCount++;
    }
  }

  bool hasBrandNewNotice = false;
  int brandNewNoticeIdx = 0;
  bool changed = false;

  if (lockNotices()) {
    for (int i = 0; i < updatedCount; i++) {
      bool existed = false;
      for (int k = 0; k < noticeCount; k++) {
        if (notices[k].id == updated[i].id) {
          existed = true;
          break;
        }
      }
      if (!existed) {
        hasBrandNewNotice = true;
        brandNewNoticeIdx = i;
        break;
      }
    }

    changed = (noticeCount != updatedCount);
    if (!changed) {
      for (int i = 0; i < noticeCount; i++) {
        if (notices[i].id != updated[i].id || notices[i].title != updated[i].title || notices[i].message != updated[i].message) {
          changed = true;
          break;
        }
      }
    }

    if (changed) {
      // Preserve breaking notice popup if the notice still exists
      bool keepPopup = false;
      if (newNoticePopupUntilMs > millis() && activeNoticePopupIndex >= 0 && activeNoticePopupIndex < noticeCount) {
        String popupId = notices[activeNoticePopupIndex].id;
        for (int i = 0; i < updatedCount; i++) {
          if (updated[i].id == popupId) {
            activeNoticePopupIndex = i;
            keepPopup = true;
            break;
          }
        }
      }
      if (!keepPopup) {
        newNoticePopupUntilMs = 0;
      }

      noticeCount = updatedCount;
      for (int i = 0; i < noticeCount; i++) {
        notices[i] = updated[i];
      }
      if (currentNoticeDisplayIndex >= noticeCount) {
        currentNoticeDisplayIndex = 0;
      }
      if (singleOledNoticeIdx >= noticeCount) {
        singleOledNoticeIdx = 0;
      }
    }
    unlockNotices();
  }

  // Trigger audio chime and popup ONLY on genuinely new announcements while system is running!
  // Never chime on bootup or historical sync
  if (hasBrandNewNotice && initialCloudNoticeSyncDone) {
    newNoticePopupUntilMs = millis() + 15000UL;
    activeNoticePopupIndex = brandNewNoticeIdx;
    pendingNoticeBeep = true;
    Serial.printf("[NOTICE] New cloud announcement received ('%s') -> Beep & Popup triggered!\n",
                  notices[brandNewNoticeIdx].title.c_str());
  }

  saveNoticesToNVS();
  Serial.printf("[SUPABASE] Cloud notices reconciled: %d active notices.\n", noticeCount);
  initialCloudNoticeSyncDone = true;
}

// Dedicated helper to pull active notices from Supabase immediately on Wi-Fi connection
void fetchNoticesFromSupabaseCloud() {
  if (WiFi.status() != WL_CONNECTED || strlen(SUPABASE_URL) == 0 || strlen(SUPABASE_KEY) == 0) return;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(4000);
  HTTPClient https;
  String urlAnn = String(SUPABASE_URL) + "/rest/v1/announcements?select=id,classroom_id,title,message,duration&is_active=eq.true&or=%28expires_at.is.null,expires_at.gt.now%28%29%29&order=created_at.desc&limit=8";
  if (https.begin(client, urlAnn)) {
    https.addHeader("apikey", SUPABASE_KEY);
    https.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
    https.addHeader("Accept", "application/json");

    int code = https.GET();
    if (code == 200) {
      String payload = https.getString();
      StaticJsonDocument<2048> doc;
      DeserializationError err = deserializeJson(doc, payload);
      if (!err && doc.is<JsonArray>()) {
        reconcileNoticesFromCloud(doc.as<JsonArray>());
      }
    }
    https.end();
    client.stop();
  }
}


// Dedicated FreeRTOS background task running on Core 0
// Ensures cloud HTTPS polling NEVER blocks Core 1's local HTTP REST API / relay
// actuation!
void supabaseCloudTask(void *pvParameters) {
  vTaskDelay(pdMS_TO_TICKS(1500)); // Allow Wi-Fi to stabilize
  bool initialNoticeSyncDone = false;
  for (;;) {
    if (WiFi.status() == WL_CONNECTED && strlen(SUPABASE_URL) > 0 &&
        strlen(SUPABASE_KEY) > 0) {
      if (!initialNoticeSyncDone) {
        fetchNoticesFromSupabaseCloud();
        initialNoticeSyncDone = true;
      }
      syncWithSupabase();
    }
    vTaskDelay(pdMS_TO_TICKS(250)); // Yield to FreeRTOS scheduler & Wi-Fi stack
  }
}

// ==========================================
// --- MAIN RUNTIME LOOP ---
// ==========================================
void loop() {
  // 1. Process Captive Portal DNS queries if in AP setup mode
  if (isApSetupMode) {
    dnsServer.processNextRequest();
  }

  // 1b. Process incoming HTTP client requests & Realtime WebSocket frames
  server.handleClient();
  if (WiFi.status() == WL_CONNECTED) {
    wsClient.loop();

    // Phoenix channel heartbeat every 20 seconds
    if (wsConnected) {
      unsigned long nowMs = millis();
      if (nowMs - lastWsHeartbeat >= 20000) {
        lastWsHeartbeat = nowMs;
        const char *hb = "{\"topic\":\"phoenix\",\"event\":\"heartbeat\",\"payload\":{},\"ref\":\"hb\"}";
        wsClient.sendTXT(hb);
      }
    }
  }

  // 1c. Non-blocking Audio Alert Buzzer & Timetable Period Bell
  if (pendingNoticeBeep) {
    pendingNoticeBeep = false;
    triggerNoticeBeep();
  }
  handleBuzzer();
  checkTimetableBell();

  // 1c1. Onboard 24/7 Autonomous Device Schedule & Countdown Timer Engine
  checkDeviceSchedules();
  checkAutoOffTimers();

  // 1c2. Non-blocking WS2812B LED Strip Animations (Breathe, Rainbow, Strobe)
  updateWs2812Animation();

  // 1d. Wi-Fi Disconnect Watchdog:
  // If Wi-Fi was connected but drops while running, wait WIFI_CONNECT_TIMEOUT_SEC then launch Hotspot
  static unsigned long wifiLostTimestamp = 0;
  if (!isApSetupMode) {
    if (WiFi.status() != WL_CONNECTED) {
      if (wifiLostTimestamp == 0) {
        wifiLostTimestamp = millis();
        Serial.println(F("\n[WIFI] Lost connection to Wi-Fi. Waiting before starting Hotspot..."));
      } else if (millis() - wifiLostTimestamp >= (unsigned long)(WIFI_CONNECT_TIMEOUT_SEC * 1000)) {
        Serial.printf("[WIFI] Reconnection timed out after %d sec. Launching Setup Hotspot!\n", WIFI_CONNECT_TIMEOUT_SEC);
        startSetupHotspot();
      }
    } else {
      wifiLostTimestamp = 0;
    }
  }

  // 2. Non-blocking DHT11 Environment Sampling
  static unsigned long lastDhtRead = 0;
  if (millis() - lastDhtRead >= DHT_READ_INTERVAL_MS) {
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t))
      currentTemp = t;
    if (!isnan(h))
      currentHum = h;
    lastDhtRead = millis();
  }

  unsigned long now = millis();

  // 3. Sample PIR Motion & Filtered Corridor LDRs
  pir1_active = (digitalRead(PIR1_PIN) == HIGH);
  pir2_active = (digitalRead(PIR2_PIN) == HIGH);

  // Smooth LDR sampling at controlled interval to filter ADC multiplexer noise & relay coil spikes
  static float ldr1_filtered = 2000.0f;
  static float ldr2_filtered = 2000.0f;
  static unsigned long lastLdrSampleMs = 0;
  static bool ldrInitialized = false;

  if (!ldrInitialized) {
    ldr1_filtered = (float)analogRead(LDR_CORRIDOR1_PIN);
    ldr2_filtered = (float)analogRead(LDR_CORRIDOR2_PIN);
    ldr1_value = (int)ldr1_filtered;
    ldr2_value = (int)ldr2_filtered;
    ldrInitialized = true;
    lastLdrSampleMs = now;
  } else if (now - lastLdrSampleMs >= LDR_SAMPLE_INTERVAL_MS) {
    lastLdrSampleMs = now;
    int raw1 = analogRead(LDR_CORRIDOR1_PIN);
    int raw2 = analogRead(LDR_CORRIDOR2_PIN);
    // Smooth low-pass filter (alpha = 0.20)
    ldr1_filtered = (ldr1_filtered * 0.80f) + (raw1 * 0.20f);
    ldr2_filtered = (ldr2_filtered * 0.80f) + (raw2 * 0.20f);
    ldr1_value = (int)ldr1_filtered;
    ldr2_value = (int)ldr2_filtered;
  }

  // 3b. Sample Classroom A101 AC Power Meter (ACS712 & ZMPT101B)
  sampleA101PowerMeter();

  // 3c. Integrate Real-Time Energy (Riemann sum: kWh = Watts * hours / 1000)
  integrateRealEnergy();

  // 4. Classroom Occupancy State Machines (Debounced Hold Timer)
  // Classroom 1 Occupancy
  if (pir1_active) {
    c1_last_motion = now;
    c1_occupied = true;
  } else if (now - c1_last_motion >= currentHoldTime) {
    c1_occupied = false;
  }

  // Classroom 2 Occupancy
  if (pir2_active) {
    c2_last_motion = now;
    c2_occupied = true;
  } else if (now - c2_last_motion >= currentHoldTime) {
    c2_occupied = false;
  }

  // 5. Intelligent Automation Logic (Only active when isAutoMode == true)
  if (isAutoMode) {
    // Corridor Automation with Hysteresis, Debounce, and Anti-Feedback Minimum Hold Time:
    // Prevents optical feedback (light turning itself off) and boundary relay chatter
    static unsigned long corr1_dark_start = 0;
    static unsigned long corr1_last_turn_on = 0;
    static unsigned long corr2_dark_start = 0;
    static unsigned long corr2_last_turn_on = 0;

    int onThreshold = currentLdrThreshold + LDR_HYSTERESIS;
    int offThreshold = currentLdrThreshold - LDR_HYSTERESIS;

    // --- Corridor 1 Light Automation ---
    if (!state_corr1_light) {
      // Light is currently OFF: Must remain dark (> onThreshold) consistently for LDR_DEBOUNCE_MS
      if (ldr1_value > onThreshold) {
        if (corr1_dark_start == 0) {
          corr1_dark_start = now;
        } else if (now - corr1_dark_start >= LDR_DEBOUNCE_MS) {
          state_corr1_light = true;
          corr1_last_turn_on = now;
          corr1_dark_start = 0;
        }
      } else {
        corr1_dark_start = 0;
      }
    } else {
      // Light is currently ON:
      // Minimum hold time: Must stay ON for at least CORRIDOR_HOLD_MS (15s)
      // This completely shields against light bounce/reflection turning the relay off!
      if (now - corr1_last_turn_on >= CORRIDOR_HOLD_MS) {
        if (ldr1_value < offThreshold) {
          state_corr1_light = false;
          corr1_dark_start = 0;
        }
      }
    }

    // --- Corridor 2 Light Automation ---
    if (!state_corr2_light) {
      if (ldr2_value > onThreshold) {
        if (corr2_dark_start == 0) {
          corr2_dark_start = now;
        } else if (now - corr2_dark_start >= LDR_DEBOUNCE_MS) {
          state_corr2_light = true;
          corr2_last_turn_on = now;
          corr2_dark_start = 0;
        }
      } else {
        corr2_dark_start = 0;
      }
    } else {
      if (now - corr2_last_turn_on >= CORRIDOR_HOLD_MS) {
        if (ldr2_value < offThreshold) {
          state_corr2_light = false;
          corr2_dark_start = 0;
        }
      }
    }

    // Classroom 1 Automation (with Temperature Hysteresis for Fan)
    if (c1_occupied) {
      state_c1_light = true;
      state_c1_curtain = true;
      if (!state_c1_fan && currentTemp > (currentTempThreshold + TEMP_HYSTERESIS)) {
        state_c1_fan = true;
      } else if (state_c1_fan && currentTemp < (currentTempThreshold - TEMP_HYSTERESIS)) {
        state_c1_fan = false;
      }
    } else {
      state_c1_light = false;
      state_c1_curtain = false;
      state_c1_fan = false;
    }

    // Classroom 2 Automation (with Temperature Hysteresis for Fan)
    if (c2_occupied) {
      state_c2_light = true;
      state_c2_curtain = true;
      if (!state_c2_fan && currentTemp > (currentTempThreshold + TEMP_HYSTERESIS)) {
        state_c2_fan = true;
      } else if (state_c2_fan && currentTemp < (currentTempThreshold - TEMP_HYSTERESIS)) {
        state_c2_fan = false;
      }
    } else {
      state_c2_light = false;
      state_c2_curtain = false;
      state_c2_fan = false;
    }
  }

  // 6. Apply hardware relay outputs
  applyRelayStates();

  // 7. Non-blocking smooth servo sweep
  updateServos();

  // 7b. Safely synchronize OLED display power states on Core 1 (prevents cross-core I2C bus contention)
  syncDisplayPowerStates();

  // (Supabase Cloud Sync runs in background on Core 0 via supabaseCloudTask)

  // 8. OLED Display Refresh (Every 1000ms)
  static unsigned long lastDisplayUpdate = 0;
  if (oledFound && (now - lastDisplayUpdate >= OLED_REFRESH_MS)) {
    if (!state_c1_smart_screen) {
      lastDisplayUpdate = now;
      return;
    }
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);

    if (isApSetupMode) {
      display.setCursor(0, 0);
      display.println(F("[WIFI SETUP AP]"));
      display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
      display.setCursor(0, 14);
      display.println(F("Hotspot Active:"));
      display.setCursor(0, 26);
      display.println(SETUP_AP_SSID);
      display.setCursor(0, 40);
      display.println(F("Connect & Open:"));
      display.setCursor(0, 52);
      display.println(F("http://192.168.4.1"));
      display.display();
      lastDisplayUpdate = now;
      return;
    }

    cleanExpiredNotices();

    // If secondary OLED is not connected, handle notices directly on primary OLED
    if (!noticeOledFound) {
      // Collect eligible notices for A101 / A102 / ALL
      int eligibleIndices[MAX_FIRMWARE_NOTICES];
      int eligibleCount = 0;
      if (lockNotices(pdMS_TO_TICKS(20))) {
        for (int i = 0; i < noticeCount; i++) {
          if (notices[i].active) {
            String cId = notices[i].classroomId;
            cId.toLowerCase();
            if (cId == "all" || cId.length() == 0 ||
                cId == "cls-a101" || cId == "a101" || cId == CLASSROOM_1_ID ||
                cId == "cls-a102" || cId == "a102" || cId == CLASSROOM_2_ID) {
              eligibleIndices[eligibleCount++] = i;
            }
          }
        }
        unlockNotices();
      }

      // Priority 0: Period Over Alert Popup (10s duration)
      if (now < periodOverAlertUntilMs) {
        display.fillRect(0, 0, 128, 14, SSD1306_WHITE);
        display.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
        display.setTextSize(1);
        display.setCursor(10, 3);
        display.print(F("*** PERIOD OVER ***"));

        display.setTextColor(SSD1306_WHITE);
        display.setCursor(0, 20);
        display.print(F("Ended:"));
        display.setCursor(0, 32);
        String pName = String(lastBellRungPeriodName);
        if (pName.length() > 21) pName = pName.substring(0, 18) + "...";
        display.print(pName);

        display.drawLine(0, 46, 128, 46, SSD1306_WHITE);
        display.setCursor(0, 52);
        display.printf("Time: %02d:%02d [BELL RUNG]", lastBellRungHour, lastBellRungMin);
        display.display();
        lastDisplayUpdate = now;
        return;
      }

      // Priority 1: High-Priority Breaking Notice Popup (15s after receipt)
      NoticeItemFirmware popItem;
      bool hasPopItem = false;
      if (now < newNoticePopupUntilMs && activeNoticePopupIndex >= 0) {
        if (lockNotices(pdMS_TO_TICKS(20))) {
          if (activeNoticePopupIndex < noticeCount && notices[activeNoticePopupIndex].active) {
            popItem = notices[activeNoticePopupIndex];
            hasPopItem = true;
          }
          unlockNotices();
        }
      }

      if (hasPopItem) {
        // 1. Top Inverted Alert Banner
        display.fillRect(0, 0, 128, 12, SSD1306_WHITE);
        display.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
        display.setCursor(6, 2);
        display.print(F("*** NEW NOTICE ***"));
        display.setTextColor(SSD1306_WHITE, SSD1306_BLACK);

        // 2. Title Line
        display.setCursor(0, 15);
        display.print(F("> "));
        String t = popItem.title;
        if (t.length() > 19) t = t.substring(0, 16) + "...";
        display.print(t);
        display.drawLine(0, 24, 128, 24, SSD1306_WHITE);

        // 3. Message Body (word-wrapped)
        drawNoticeWordWrap(display, popItem.message, 0, 27, 21, 0);

        // 4. Footer Line with target & timer countdown
        display.fillRect(0, 52, 128, 12, SSD1306_BLACK);
        display.drawLine(0, 52, 128, 52, SSD1306_WHITE);
        display.setCursor(0, 55);
        int secRem = (int)((newNoticePopupUntilMs - now) / 1000) + 1;
        String tgt = popItem.classroomId;
        if (tgt == "all" || tgt.length() == 0) tgt = "ALL";
        else if (tgt.indexOf("101") != -1) tgt = "A101";
        else if (tgt.indexOf("102") != -1) tgt = "A102";
        display.printf("To:%-4s     [Alert %ds]", tgt.c_str(), secRem);

        display.display();
        lastDisplayUpdate = now;
        return;
      }

      // Priority 2: Periodic Carousel Rotation (10s Telemetry / 8s Notice Card)
      static unsigned long singleOledModeStartMs = 0;
      static int singleOledScreen = 0; // 0: Telemetry, 1: Notice

      if (singleOledModeStartMs == 0) singleOledModeStartMs = now;

      if (singleOledScreen == 0) {
        if (eligibleCount > 0 && (now - singleOledModeStartMs >= 10000UL)) {
          singleOledScreen = 1;
          singleOledModeStartMs = now;
        }
      } else if (singleOledScreen == 1) {
        if (eligibleCount == 0 || (now - singleOledModeStartMs >= 8000UL)) {
          singleOledScreen = 0;
          singleOledModeStartMs = now;
          if (eligibleCount > 0) {
            singleOledNoticeIdx = (singleOledNoticeIdx + 1) % eligibleCount;
          }
        }
      }

      if (singleOledScreen == 1 && eligibleCount > 0) {
        int nIdx = eligibleIndices[singleOledNoticeIdx % eligibleCount];
        NoticeItemFirmware item;
        bool hasItem = false;
        if (lockNotices(pdMS_TO_TICKS(20))) {
          if (nIdx < noticeCount && notices[nIdx].active) {
            item = notices[nIdx];
            hasItem = true;
          }
          unlockNotices();
        }

        if (hasItem) {
          String tgt = item.classroomId;
          if (tgt == "all" || tgt.length() == 0) tgt = "ALL";
          else if (tgt.indexOf("101") != -1) tgt = "A101";
          else if (tgt.indexOf("102") != -1) tgt = "A102";

          display.setCursor(0, 0);
          if (eligibleCount > 1) {
            display.printf("[%d/%d] NOTICE (%s)", (singleOledNoticeIdx % eligibleCount) + 1, eligibleCount, tgt.c_str());
          } else {
            display.printf("NOTICE BOARD (%s)", tgt.c_str());
          }
          display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

          // Title
          display.setCursor(0, 14);
          display.print(F("> "));
          String t = item.title;
          if (t.length() > 19) t = t.substring(0, 16) + "...";
          display.print(t);
          display.drawLine(0, 23, 128, 23, SSD1306_WHITE);

          // Message Body
          drawNoticeWordWrap(display, item.message, 0, 26, 21, 0);

          // Footer
          display.fillRect(0, 52, 128, 12, SSD1306_BLACK);
          display.drawLine(0, 52, 128, 52, SSD1306_WHITE);
          display.setCursor(0, 55);
          display.printf("Duration: %s", item.duration.c_str());

          display.display();
          lastDisplayUpdate = now;
          return;
        }
      }
    }

    display.setCursor(0, 0);

    // Line 1: IP & Mode
    display.print(F("IP:"));
    if (WiFi.status() == WL_CONNECTED) {
      display.print(WiFi.localIP());
    } else {
      display.print(F("OFFLINE"));
    }
    display.setCursor(92, 0);
    if (supabaseSyncActive) {
      display.println(isAutoMode ? F("CLD:A") : F("CLD:M"));
    } else {
      display.println(isAutoMode ? F("AUTO") : F("MANU"));
    }

    // Separator line
    display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

    // Line 2: Climate Telemetry
    display.setCursor(0, 14);
    display.printf("T:%.1fC  H:%.0f%%  %dW", currentTemp, currentHum,
                   (int)getTotalLoadWatts());

    // Line 3: Classroom 1 Status & Energy Meter
    display.setCursor(0, 26);
    if (c1_voltage >= 60.0f || c1_current >= 0.09f) {
      display.printf("A101:%s %.0fV %.2fA", c1_occupied ? "OCC" : "VAC",
                     c1_voltage, c1_current);
    } else {
      display.print(F("C1:"));
      display.print(c1_occupied ? F("[OCC] ") : F("[VAC] "));
      display.print(state_c1_light ? F("L1 ") : F("L0 "));
      display.print(state_c1_fan ? F("F1 ") : F("F0 "));
      display.print(state_c1_curtain ? F("C1") : F("C0"));
    }

    // Line 4: Classroom 2 Status
    display.setCursor(0, 38);
    display.print(F("C2:"));
    display.print(c2_occupied ? F("[OCC] ") : F("[VAC] "));
    display.print(state_c2_light ? F("L1 ") : F("L0 "));
    display.print(state_c2_fan ? F("F1 ") : F("F0 "));
    display.print(state_c2_curtain ? F("C1") : F("C0"));

    // Line 5: Corridors
    display.setCursor(0, 50);
    display.print(F("CR:"));
    display.print(state_corr1_light ? F("L1:ON ") : F("L1:-- "));
    display.print(state_corr2_light ? F("L2:ON") : F("L2:--"));

    display.display();
    lastDisplayUpdate = now;
  }

  // 9. Refresh Classroom Digital Notice Board OLED (Rotates every 10s if multiple)
  updateNoticeBoardDisplay();

  // Prevent ESP32 task starvation / watchdog triggers
  delay(2);
}
