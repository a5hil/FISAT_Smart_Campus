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

// ==========================================
// --- 3V BUZZER AUDIO ALERT STATE ---
// ==========================================
volatile int buzzerBeepsRemaining = 0;
volatile int buzzerCurrentDurationMs = BUZZER_BEEP_DURATION_MS;
volatile int buzzerCurrentPauseMs = BUZZER_BEEP_PAUSE_MS;
volatile unsigned long buzzerNextToggleMs = 0;
volatile bool buzzerIsSounding = false;

void buzzerSoundOn() {
#if defined(BUZZER_PIN) && BUZZER_PIN >= 0
#if BUZZER_IS_ACTIVE
  digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? HIGH : LOW);
#else
  tone(BUZZER_PIN, BUZZER_TONE_FREQ);
#endif
#endif
}

void buzzerSoundOff() {
#if defined(BUZZER_PIN) && BUZZER_PIN >= 0
#if BUZZER_IS_ACTIVE
  digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? LOW : HIGH);
#else
  noTone(BUZZER_PIN);
#endif
#endif
}

void triggerBuzzerBeep(int beeps = BUZZER_NOTICE_BEEPS, int durationMs = BUZZER_BEEP_DURATION_MS, int pauseMs = BUZZER_BEEP_PAUSE_MS) {
#if defined(BUZZER_PIN) && BUZZER_PIN >= 0
  buzzerBeepsRemaining = beeps;
  buzzerCurrentDurationMs = durationMs;
  buzzerCurrentPauseMs = pauseMs;
  buzzerNextToggleMs = millis();
  buzzerIsSounding = false;
#endif
}

void triggerNoticeBeep() {
  triggerBuzzerBeep(BUZZER_NOTICE_BEEPS, BUZZER_BEEP_DURATION_MS, BUZZER_BEEP_PAUSE_MS);
}

void handleBuzzer() {
#if defined(BUZZER_PIN) && BUZZER_PIN >= 0
  if (buzzerBeepsRemaining <= 0) return;
  unsigned long now = millis();
  if (now >= buzzerNextToggleMs) {
    if (!buzzerIsSounding) {
      buzzerSoundOn();
      buzzerIsSounding = true;
      buzzerNextToggleMs = now + buzzerCurrentDurationMs;
    } else {
      buzzerSoundOff();
      buzzerIsSounding = false;
      buzzerBeepsRemaining--;
      if (buzzerBeepsRemaining > 0) {
        buzzerNextToggleMs = now + buzzerCurrentPauseMs;
      }
    }
  }
#endif
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

// Display States for Classroom 1 (A101)
volatile bool state_c1_smart_screen = true;   // Primary OLED (Telemetry Display on Wire)
volatile bool state_c1_notice_screen = true;  // Secondary OLED (Notice Board on Wire1)

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
bool cloud_prev_system_auto = false;
volatile bool pendingModeCloudSync = false;
volatile bool pendingIpCloudSync = true;
unsigned long lastLocalModeChange = 0;

// OLED Hardware flag
bool oledFound = false;

void setSmartScreenPower(bool on) {
  state_c1_smart_screen = on;
  if (oledFound) {
    if (on) {
      display.ssd1306_command(SSD1306_DISPLAYON);
    } else {
      display.clearDisplay();
      display.display();
      display.ssd1306_command(SSD1306_DISPLAYOFF);
    }
  }
  Serial.printf("[DISPLAY] Smart Screen (Telemetry) -> %s\n", on ? "ON" : "OFF");
}

void setNoticeScreenPower(bool on) {
  state_c1_notice_screen = on;
  if (noticeOledFound) {
    if (on) {
      displayNotice.ssd1306_command(SSD1306_DISPLAYON);
    } else {
      displayNotice.clearDisplay();
      displayNotice.display();
      displayNotice.ssd1306_command(SSD1306_DISPLAYOFF);
    }
  }
  Serial.printf("[DISPLAY] Notice Board Screen -> %s\n", on ? "ON" : "OFF");
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
  return w;
}

float getCorrLoadWatts() {
  float w = 0.0;
  if (state_corr1_light)
    w += rated_corr1;
  if (state_corr2_light)
    w += rated_corr2;
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
    preferences.putFloat("c1_kwh", (float)c1_accumulated_kwh);
    preferences.putFloat("c2_kwh", (float)c2_accumulated_kwh);
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
    preferences.putBool("auto_mode", autoMode);
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

  int t_c1_l = state_c1_light ? RELAY_ON : RELAY_OFF;
  if (hw_c1_light != t_c1_l) {
    digitalWrite(RELAY_CLASS_LIGHT1, t_c1_l);
    hw_c1_light = t_c1_l;
  }

  int t_c1_f = state_c1_fan ? RELAY_ON : RELAY_OFF;
  if (hw_c1_fan != t_c1_f) {
    digitalWrite(RELAY_CLASS_FAN1, t_c1_f);
    hw_c1_fan = t_c1_f;
  }

  int t_c2_l = state_c2_light ? RELAY_ON : RELAY_OFF;
  if (hw_c2_light != t_c2_l) {
    digitalWrite(RELAY_CLASS_LIGHT2, t_c2_l);
    hw_c2_light = t_c2_l;
  }

  int t_c2_f = state_c2_fan ? RELAY_ON : RELAY_OFF;
  if (hw_c2_fan != t_c2_f) {
    digitalWrite(RELAY_CLASS_FAN2, t_c2_f);
    hw_c2_fan = t_c2_f;
  }

  int t_cr1 = state_corr1_light ? RELAY_ON : RELAY_OFF;
  if (hw_corr1 != t_cr1) {
    digitalWrite(RELAY_CORRIDOR_LIGHT1, t_cr1);
    hw_corr1 = t_cr1;
  }

  int t_cr2 = state_corr2_light ? RELAY_ON : RELAY_OFF;
  if (hw_corr2 != t_cr2) {
    digitalWrite(RELAY_CORRIDOR_LIGHT2, t_cr2);
    hw_corr2 = t_cr2;
  }
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
  json += "\"light2\":" + String(state_corr2_light ? "true" : "false");
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

  // Classroom 1 / A101
  if (dev == "l1" || dev == "light1" || dev == "dev-a101-light" ||
      dev == "dev-a101-light-1" || dev == "dev-a101-light-2") {
    state_c1_light = st;
  } else if (dev == "f1" || dev == "fan1" || dev == "dev-a101-fan" ||
             dev == "dev-a101-fan-1" || dev == "dev-a101-fan-2") {
    state_c1_fan = st;
  } else if (dev == "c1" || dev == "curtain1" || dev == "dev-a101-curtain") {
    state_c1_curtain = st;
  } else if (dev == "nb" || dev == "notice" || dev == "notice_board" ||
             dev == "dev-a101-notice-board" || dev == "dev-a101-notice") {
    setNoticeScreenPower(st);
  } else if (dev == "ss" || dev == "smart" || dev == "smart_screen" ||
             dev == "dev-a101-smart-screen" || dev == "dev-a101-screen") {
    setSmartScreenPower(st);
  }
  // Classroom 2 / A102
  else if (dev == "l2" || dev == "light2" || dev == "dev-a102-light" ||
           dev == "dev-a102-light-1" || dev == "dev-a102-light-2") {
    state_c2_light = st;
  } else if (dev == "f2" || dev == "fan2" || dev == "dev-a102-fan" ||
             dev == "dev-a102-fan-1" || dev == "dev-a102-fan-2") {
    state_c2_fan = st;
  } else if (dev == "c2" || dev == "curtain2" || dev == "dev-a102-curtain") {
    state_c2_curtain = st;
  }
  // Corridors
  else if (dev == "cr1" || dev == "corridor1" || dev == "corr1" ||
           dev == "dev-corr-light1" || dev == "dev-corr-light-1") {
    state_corr1_light = st;
  } else if (dev == "cr2" || dev == "corridor2" || dev == "corr2" ||
             dev == "dev-corr-light2" || dev == "dev-corr-light-2") {
    state_corr2_light = st;
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
  }

  // Instantly apply relay pin states
  applyRelayStates();
}

void handleControl() {
  enableCORS();

  // Handle Query Parameters (GET /ctrl?dev=l1&st=1)
  if (server.hasArg("dev") && server.arg("st")) {
    String dev = server.arg("dev");
    bool st = (server.arg("st") == "1" || server.arg("st") == "true" ||
               server.arg("st") == "on");

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
  if (server.hasArg("c1_light_w")) {
    rated_c1_light = server.arg("c1_light_w").toFloat();
    preferences.putFloat("r_c1_l", rated_c1_light);
  }
  if (server.hasArg("c1_fan_w")) {
    rated_c1_fan = server.arg("c1_fan_w").toFloat();
    preferences.putFloat("r_c1_f", rated_c1_fan);
  }
  if (server.hasArg("c2_light_w")) {
    rated_c2_light = server.arg("c2_light_w").toFloat();
    preferences.putFloat("r_c2_l", rated_c2_light);
  }
  if (server.hasArg("c2_fan_w")) {
    rated_c2_fan = server.arg("c2_fan_w").toFloat();
    preferences.putFloat("r_c2_f", rated_c2_fan);
  }
  if (server.hasArg("corr1_w")) {
    rated_corr1 = server.arg("corr1_w").toFloat();
    preferences.putFloat("r_cr1", rated_corr1);
  }
  if (server.hasArg("corr2_w")) {
    rated_corr2 = server.arg("corr2_w").toFloat();
    preferences.putFloat("r_cr2", rated_corr2);
  }

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
                  "<title>NBA Smart Classroom - Wi-Fi Setup</title>"
                  "<style>"
                  "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0F0F0F;color:#FFF;margin:0;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;box-sizing:border-box;}"
                  ".card{background:#1A1A1A;border:1px solid #2D2D2D;border-radius:16px;padding:26px;max-width:420px;width:100%;box-shadow:0 12px 30px rgba(0,0,0,0.6);}"
                  ".badge{display:inline-block;background:rgba(253,168,58,0.15);color:#FDA83A;font-weight:700;font-size:12px;padding:4px 10px;border-radius:20px;margin-bottom:12px;}"
                  "h1{font-size:22px;margin:0 0 6px 0;font-weight:700;color:#FFF;}"
                  "p{color:#A0A0A0;font-size:13px;line-height:1.5;margin:0 0 20px 0;}"
                  "label{display:block;font-size:13px;font-weight:600;color:#DDD;margin-bottom:6px;}"
                  "select,input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;background:#242424;border:1px solid #333;color:#FFF;font-size:14px;margin-bottom:16px;outline:none;}"
                  "select:focus,input:focus{border-color:#FDA83A;}"
                  ".btn{width:100%;padding:14px;border-radius:10px;border:none;background:#FDA83A;color:#000;font-size:15px;font-weight:700;cursor:pointer;margin-top:6px;}"
                  ".btn:active{opacity:0.85;}"
                  ".info{margin-top:20px;padding-top:14px;border-top:1px solid #262626;font-size:12px;color:#777;display:flex;justify-content:space-between;}"
                  "</style></head><body>"
                  "<div class='card'>"
                  "<div class='badge'>Controller Network Setup</div>"
                  "<h1>Wi-Fi Configuration</h1>"
                  "<p>Select your Wi-Fi network and enter the password to connect this classroom controller.</p>"
                  "<form action='/savewifi' method='POST'>"
                  "<label for='ssid'>Available Networks</label>"
                  "<select id='ssid' name='ssid' onchange='checkCustom(this.value)'>");

  if (n <= 0) {
    html += F("<option value=''>-- No networks found (Refresh to scan) --</option>");
  } else {
    for (int i = 0; i < n; ++i) {
      String s = WiFi.SSID(i);
      int r = WiFi.RSSI(i);
      String lock = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "" : " 🔒";
      html += "<option value='" + s + "'>" + s + " (" + String(r) + " dBm" + lock + ")</option>";
    }
  }
  html += F("<option value='__custom__'>+ Enter custom / hidden SSID...</option>"
            "</select>"
            "<div id='customDiv' style='display:none;'>"
            "<label for='custom_ssid'>Custom SSID</label>"
            "<input type='text' id='custom_ssid' name='custom_ssid' placeholder='Enter network name'>"
            "</div>"
            "<label for='password'>Wi-Fi Password</label>"
            "<input type='password' id='password' name='password' placeholder='Enter password (leave blank if open)'>"
            "<button type='submit' class='btn'>Connect & Save</button>"
            "</form>"
            "<div class='info'>"
            "<span>Firmware: v");
  html += FIRMWARE_VERSION;
  html += F("</span>"
            "<span>IP: 192.168.4.1</span>"
            "</div>"
            "</div>"
            "<script>"
            "function checkCustom(val){"
            "  var c = document.getElementById('customDiv');"
            "  c.style.display = (val === '__custom__') ? 'block' : 'none';"
            "}"
            "</script>"
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

  preferences.putString("wifi_ssid", ssid);
  preferences.putString("wifi_pass", pass);

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

  preferences.putString("wifi_ssid", ssid);
  preferences.putString("wifi_pass", pass);

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
}

// Forward declarations for NVS persistence
void saveNoticesToNVS();
void loadNoticesFromNVS();

void saveNoticesToNVS() {
  StaticJsonDocument<2048> doc;
  JsonArray arr = doc.to<JsonArray>();
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
  String out;
  serializeJson(doc, out);
  preferences.putString("notices_json", out);
  Serial.printf("[NVS] Saved %d notices to persistent flash memory.\n", arr.size());
}

void loadNoticesFromNVS() {
  String stored = preferences.getString("notices_json", "");
  if (stored.length() > 5) {
    StaticJsonDocument<2048> doc;
    DeserializationError err = deserializeJson(doc, stored);
    if (!err && doc.is<JsonArray>()) {
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
      Serial.printf("[NOTICE] Restored %d persistent notices from NVS flash memory.\n", noticeCount);
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
      saveNoticesToNVS();
      Serial.printf("[NOTICE] Deleted notice id '%s'\n", id.c_str());
      return true;
    }
  }
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

  // Find notices targeted to Classroom A101 (or "all")
  int eligibleIndices[MAX_FIRMWARE_NOTICES];
  int eligibleCount = 0;
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

  if (eligibleCount == 0) {
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

  int activeNoticeIdx = eligibleIndices[currentNoticeDisplayIndex];
  NoticeItemFirmware &item = notices[activeNoticeIdx];

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
    struct timeval tv;
    tv.tv_sec = epoch;
    tv.tv_usec = 0;
    settimeofday(&tv, NULL);
    server.send(200, "application/json", "{\"status\":\"ok\",\"synced_epoch\":" + String((long)epoch) + "}");
    Serial.printf("[TIME] Manually synchronized epoch: %ld\n", (long)epoch);
    return;
  }
  server.send(400, "application/json", "{\"error\":\"invalid epoch\"}");
}

// REST Handler to Test 3V Audio Buzzer
void handleBuzzerTest() {
  enableCORS();
  triggerNoticeBeep();
  server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Buzzer alert beep triggered\"}");
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
  loadNoticesFromNVS(); // Immediately restore notices onto Notice OLED on boot
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
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerSoundOff();
  Serial.printf("[HARDWARE] 3V Alert Buzzer initialized on GPIO %d (Type: %s)\n", 
                BUZZER_PIN, BUZZER_IS_ACTIVE ? "ACTIVE" : "PASSIVE");
#endif

  // 2. Initialize Relay Output Pins
  pinMode(RELAY_CLASS_LIGHT1, OUTPUT);
  pinMode(RELAY_CLASS_FAN1, OUTPUT);
  pinMode(RELAY_CLASS_LIGHT2, OUTPUT);
  pinMode(RELAY_CLASS_FAN2, OUTPUT);
  pinMode(RELAY_CORRIDOR_LIGHT1, OUTPUT);
  pinMode(RELAY_CORRIDOR_LIGHT2, OUTPUT);

  // Explicitly initialize relay pins to OFF before attaching loads
  digitalWrite(RELAY_CLASS_LIGHT1, RELAY_OFF);
  digitalWrite(RELAY_CLASS_FAN1, RELAY_OFF);
  digitalWrite(RELAY_CLASS_LIGHT2, RELAY_OFF);
  digitalWrite(RELAY_CLASS_FAN2, RELAY_OFF);
  digitalWrite(RELAY_CORRIDOR_LIGHT1, RELAY_OFF);
  digitalWrite(RELAY_CORRIDOR_LIGHT2, RELAY_OFF);
  applyRelayStates();

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

  server.onNotFound(handleNotFound); // Captive portal redirect & CORS preflight
  server.begin();
  Serial.println(F("[OK] HTTP API Server Started"));

  // 9. Launch Supabase Cloud Task on Core 0 (Background)
  // 16KB stack space ensures safe mbedTLS execution without stack overflow
  xTaskCreatePinnedToCore(supabaseCloudTask, "SupabaseCloudTask", 16384, NULL,
                          1, NULL, 0);
  Serial.println(F("[OK] Supabase Cloud Background Task started on Core 0"));
}

// ==========================================
// --- SUPABASE CLOUD SYNCHRONIZATION ---
// ==========================================
unsigned long lastSupabasePoll = 0;
unsigned long lastSupabaseTelemetry = 0;
bool supabaseSyncActive = false;

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

  // 1. Fetch Remote Device Commands from Supabase (Every 1000ms)
  if (now - lastSupabasePoll >= SUPABASE_POLL_INTERVAL_MS) {
    lastSupabasePoll = now;

    WiFiClientSecure client;
    client.setInsecure(); // Supabase HTTPS
    client.setTimeout(
        5000); // 5000ms socket timeout (allows TLS handshake over Internet)

    HTTPClient https;
    https.setTimeout(5000);
    String url = String(SUPABASE_URL) + "/rest/v1/devices?select=id,status";
    if (https.begin(client, url)) {
      https.addHeader("apikey", SUPABASE_KEY);
      https.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      https.addHeader("Accept", "application/json");

      int httpCode = https.GET();
      if (httpCode == 200) {
        supabaseSyncActive = true;
        String payload = https.getString();

        StaticJsonDocument<1536> doc;
        DeserializationError err = deserializeJson(doc, payload);
        if (!err && doc.is<JsonArray>()) {
          bool anyStateChanged = false;
          for (JsonObject dev : doc.as<JsonArray>()) {
            const char *id = dev["id"];
            const char *st = dev["status"];
            if (!id || !st)
              continue;

            // 1. System Mode command from Cloud (with anti-echo shield)
            if (strcmp(id, "dev-system-mode") == 0) {
              bool cloudAuto = (strcmp(st, "auto") == 0);

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
            }
          }

          if (!cloud_initialized)
            cloud_initialized = true;

          if (anyStateChanged) {
            applyRelayStates();
          }
        }
      } else {
        supabaseSyncActive = false;
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
    client.setTimeout(5000);
    HTTPClient https;
    https.setTimeout(5000);

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
      String urlAnn = String(SUPABASE_URL) + "/rest/v1/notifications?type=like.notice*&order=created_at.desc&limit=8";
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

    telemetryStep = (telemetryStep + 1) % 5;
    return;
  }
}

void reconcileNoticesFromCloud(JsonArray cloudNotices) {
  NoticeItemFirmware updated[MAX_FIRMWARE_NOTICES];
  int updatedCount = 0;

  for (JsonObject a : cloudNotices) {
    const char* aid = a["id"];
    const char* cid = a["classroom_id"];
    const char* atitle = a["title"];
    const char* amsg = a["message"];
    const char* atype = a["type"];
    String dur = "24h";
    if (atype && strstr(atype, "notice:") == atype) {
      dur = String(atype + 7);
    }
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
      for (int k = 0; k < noticeCount; k++) {
        if (notices[k].id == String(aid)) {
          origCreatedAt = notices[k].createdAtMs;
          break;
        }
      }
      updated[updatedCount].createdAtMs = origCreatedAt;
      updated[updatedCount].active = true;
      updatedCount++;
    }
  }

  bool changed = (noticeCount != updatedCount);
  if (!changed) {
    for (int i = 0; i < noticeCount; i++) {
      if (notices[i].id != updated[i].id || notices[i].title != updated[i].title || notices[i].message != updated[i].message) {
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    // Check if there is a brand new notice that didn't exist locally before
    bool hasBrandNewNotice = false;
    for (int i = 0; i < updatedCount; i++) {
      bool exists = false;
      for (int k = 0; k < noticeCount; k++) {
        if (notices[k].id == updated[i].id) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        hasBrandNewNotice = true;
        break;
      }
    }

    if (hasBrandNewNotice && cloud_initialized) {
      triggerNoticeBeep();
    }

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
    saveNoticesToNVS();
    Serial.printf("[SUPABASE] Cloud notices reconciled: %d active notices.\n", noticeCount);
  }
}

// Dedicated helper to pull active notices from Supabase immediately on Wi-Fi connection
void fetchNoticesFromSupabaseCloud() {
  if (WiFi.status() != WL_CONNECTED || strlen(SUPABASE_URL) == 0 || strlen(SUPABASE_KEY) == 0) return;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(4000);
  HTTPClient https;
  String urlAnn = String(SUPABASE_URL) + "/rest/v1/notifications?type=like.notice*&order=created_at.desc&limit=8";
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
    vTaskDelay(pdMS_TO_TICKS(60)); // Yield to FreeRTOS scheduler
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

  // 1b. Process incoming HTTP client requests
  server.handleClient();

  // 1c. Non-blocking Audio Alert Buzzer
  handleBuzzer();

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

  // 3. Sample PIR Motion & Corridor LDRs
  pir1_active = (digitalRead(PIR1_PIN) == HIGH);
  pir2_active = (digitalRead(PIR2_PIN) == HIGH);
  ldr1_value = analogRead(LDR_CORRIDOR1_PIN);
  ldr2_value = analogRead(LDR_CORRIDOR2_PIN);

  // 3b. Sample Classroom A101 AC Power Meter (ACS712 & ZMPT101B)
  sampleA101PowerMeter();

  // 3c. Integrate Real-Time Energy (Riemann sum: kWh = Watts * hours / 1000)
  integrateRealEnergy();

  // 4. Classroom Occupancy State Machines (Debounced Hold Timer)
  unsigned long now = millis();

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
    // Corridor Automation: Dark environment activates lights
    state_corr1_light = (ldr1_value > currentLdrThreshold);
    state_corr2_light = (ldr2_value > currentLdrThreshold);

    // Classroom 1 Automation
    if (c1_occupied) {
      state_c1_light = true;
      state_c1_curtain = true;
      state_c1_fan = (currentTemp > currentTempThreshold);
    } else {
      state_c1_light = false;
      state_c1_curtain = false;
      state_c1_fan = false;
    }

    // Classroom 2 Automation
    if (c2_occupied) {
      state_c2_light = true;
      state_c2_curtain = true;
      state_c2_fan = (currentTemp > currentTempThreshold);
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

      // Priority 1: High-Priority Breaking Notice Popup (15s after receipt)
      if (now < newNoticePopupUntilMs && activeNoticePopupIndex >= 0 &&
          activeNoticePopupIndex < noticeCount && notices[activeNoticePopupIndex].active) {
        NoticeItemFirmware &popItem = notices[activeNoticePopupIndex];

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
        NoticeItemFirmware &item = notices[nIdx];

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
