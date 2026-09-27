/**
 * ==============================================================================
 * SMART CLASSROOM AUTOMATION SYSTEM - DUAL ZONE CONTROLLER
 * Configuration & Pin Mapping Header
 * Project: NBA Smart Classroom App (NBA_SCR_App)
 * Hardware Target: ESP32 Development Board (ESP32-WROOM-32)
 * ==============================================================================
 */

#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ==========================================
// --- WI-FI & NETWORK SETTINGS ---
// ==========================================
// Default fallback credentials if no Wi-Fi is configured in NVS Flash
const char *const DEFAULT_WIFI_SSID = "IDEA LAB";
const char *const DEFAULT_WIFI_PASSWORD = "idea#fisat";

// Backward-compatible aliases
#define WIFI_SSID DEFAULT_WIFI_SSID
#define WIFI_PASSWORD DEFAULT_WIFI_PASSWORD

// Standalone Setup Hotspot
// Automatically starts if connection to saved Wi-Fi fails or times out
const char *const SETUP_AP_SSID = "NBA-Smart-Classroom";
const char *const SETUP_AP_PASSWORD = ""; // Open hotspot for effortless connection
const int WIFI_CONNECT_TIMEOUT_SEC = 15;  // Seconds before starting setup hotspot

// Network Identifiers
const char *const HOSTNAME =
    "esp32-classroom"; // Accessible at http://esp32-classroom.local
const char *const FIRMWARE_VERSION = "2.5.0";
const int WEB_SERVER_PORT = 80;

// ==========================================
// --- SUPABASE CLOUD DATABASE SETTINGS ---
// ==========================================
const char *const SUPABASE_URL = "https://iynufzhopcrdadtluqnx.supabase.co";
const char *const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5bnVmemhvcGNyZGFkdGx1cW54Iiwicm9sZSI6Im"
    "Fub24iLCJpYXQiOjE3ODkzNjMwOTEsImV4cCI6MjEwNDkzOTA5MX0.JqwsP1SB7gAHCFu_"
    "Ed60PU0MOmdPakFmD0KNtZMXqa4";

// Cloud Polling & Telemetry Frequencies
const unsigned long SUPABASE_POLL_INTERVAL_MS =
    1000; // Poll device state changes from cloud every 1.0s
const unsigned long SUPABASE_TELEMETRY_INTERVAL_MS =
    4000; // Push one rotating telemetry slot every 4.0s

// ==========================================
// --- CLASSROOM MAPPING (App Schema) ---
// ==========================================
// Maps to the React Native App's Classroom IDs & Names
#define CLASSROOM_1_ID "cls-a101"
#define CLASSROOM_1_NAME "Classroom A101"
#define CLASSROOM_1_NUM "A101"

#define CLASSROOM_2_ID "cls-a102"
#define CLASSROOM_2_NAME "Classroom A102"
#define CLASSROOM_2_NUM "A102"

// ==========================================
// --- GPIO PIN DEFINITIONS ---
// ==========================================

// --- I2C OLED Display 1: System & Energy Telemetry (SSD1306 128x64 on Wire) ---
#define OLED_SDA_PIN 21
#define OLED_SCL_PIN 22
#define OLED_I2C_ADDR 0x3C
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET_PIN -1

// --- I2C OLED Display 2: Classroom Digital Notice Board (SSD1306 128x64 on Wire1) ---
// Uses secondary hardware I2C bus (Wire1) so NO soldering or jumper cutting is needed!
#define NOTICE_OLED_SDA_PIN 13 // Secondary I2C Data
#define NOTICE_OLED_SCL_PIN 15 // Secondary I2C Clock
#define NOTICE_OLED_I2C_ADDR 0x3C
#define NOTICE_ROTATION_MS 20000 // Rotate through notices every 20 seconds
#define CLOCK_INTERVAL_MS 120000 // Display clock slide every 2 minutes (120s)
#define CLOCK_DISPLAY_DURATION_MS 8000 // Show clock for 8 seconds

// --- NTP Real-Time Clock Configuration (Zero Hardware) ---
#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.google.com"
#define NTP_SERVER_3 "asia.pool.ntp.org"
#define GMT_OFFSET_SEC 19800    // UTC+5:30 (Indian Standard Time: 5.5h * 3600 = 19800s)
#define DAYLIGHT_OFFSET_SEC 0   // No daylight saving time in IST

// --- 3V Audio Alert Buzzer ---
// Configurable GPIO pin for audio alerts (e.g. short beep on new notice)
// GPIO 23 is general-purpose, boot-safe, and has 3.3V drive capability
#define BUZZER_PIN 23

// Buzzer Mode:
// Set to true if using an Active Buzzer (built-in oscillator, driven by DC HIGH/LOW)
// Set to false if using a Passive Buzzer (driven by frequency tone PWM)
#define BUZZER_IS_ACTIVE true

// Logic level for Active Buzzer:
// Most 3V active buzzers are Active-HIGH (HIGH = sound, LOW = silence)
#define BUZZER_ACTIVE_HIGH true

// Default frequency for passive buzzer (Hz)
#define BUZZER_TONE_FREQ 2700

// Notification chime parameters
#define BUZZER_NOTICE_BEEPS 2       // Number of short beeps on new notice
#define BUZZER_BEEP_DURATION_MS 90  // Milliseconds per beep
#define BUZZER_BEEP_PAUSE_MS 60     // Pause between multiple beeps

// --- Shared Environment Sensors ---
#define DHTPIN 4      // DHT11 or DHT22 Temperature & Humidity Sensor
#define DHTTYPE DHT11 // Options: DHT11, DHT22, DHT21

// --- Classroom 1 (A101) Pins ---
#define PIR1_PIN 32           // Motion sensor for Classroom 1 (ADC1 / Input)
#define RELAY_CLASS_LIGHT1 25 // Main lighting relay for Classroom 1
#define RELAY_CLASS_FAN1 27   // Fan control relay for Classroom 1
#define SERVO1_PIN 18         // Curtain / Blind servo for Classroom 1

// --- Classroom 1 (A101) Real-Time Energy Meter ---
// Both pins are on ADC1 (Wi-Fi safe) and dedicated input-only pins on ESP32
#define ACS712_CURRENT_PIN                                                     \
  36 // SENSOR_VP (GPIO36) - ACS712 Current Sensor Analog Out
#define ZMPT101B_VOLTAGE_PIN                                                   \
  39 // SENSOR_VN (GPIO39) - ZMPT101B AC Voltage Sensor Analog Out

// Calibration Constants for A101 AC Power Meter
// ACS712 Sensitivity:
//   5A Model  = 0.185 V/A (185 mV/A)
//   20A Model = 0.100 V/A (100 mV/A)
//   30A Model = 0.066 V/A (66 mV/A)
const float ACS712_SENSITIVITY =
    0.185; // Default: ACS712-05B (change to 0.100 for 20A)
const float ZMPT101B_CALIBRATION =
    640.0;                            // Voltage scale factor for ~230V AC mains
const float POWER_FACTOR_A101 = 0.95; // Typical active load power factor
const unsigned long POWER_METER_SAMPLE_MS =
    1000; // Sample power every 1.0 second

// --- Classroom 2 (A102) Pins ---
#define PIR2_PIN 33           // Motion sensor for Classroom 2 (ADC1 / Input)
#define RELAY_CLASS_LIGHT2 26 // Main lighting relay for Classroom 2
#define RELAY_CLASS_FAN2 14   // Fan control relay for Classroom 2
#define SERVO2_PIN 19         // Curtain / Blind servo for Classroom 2

// --- Corridor & Peripheral Pins ---
#define LDR_CORRIDOR1_PIN 34 // LDR Light sensor 1 (ADC1 - Wi-Fi safe)
#define LDR_CORRIDOR2_PIN 35 // LDR Light sensor 2 (ADC1 - Wi-Fi safe)

// Note on Relay Corridor Pins:
// Defaulting to GPIO 16 & 17 for clean boot stability.
// (Avoid GPIO 12 if your relay module has active pull-ups, as it's a
// boot-strapping pin)
#define RELAY_CORRIDOR_LIGHT1                                                  \
  16 // Corridor 1 lights relay (Set to 12 if strictly using old wiring)
#define RELAY_CORRIDOR_LIGHT2                                                  \
  17 // Corridor 2 lights relay (Set to 13 if strictly using old wiring)

// ==========================================
// --- RELAY HARDWARE LOGIC ---
// ==========================================
// Most multi-channel relay modules are Active-LOW (LOW turns relay ON).
// Set to false if you are using an Active-HIGH relay module.
#define RELAY_ACTIVE_LOW true

#if RELAY_ACTIVE_LOW
#define RELAY_ON LOW
#define RELAY_OFF HIGH
#else
#define RELAY_ON HIGH
#define RELAY_OFF LOW
#endif

// ==========================================
// --- AUTOMATION CONSTANTS & THRESHOLDS ---
// ==========================================
// Ambient light threshold for corridors (0-4095 on ESP32 12-bit ADC)
// Readings ABOVE this threshold indicate darkness (turn on lights)
const int DEFAULT_LDR_THRESHOLD = 2000;

// Temperature threshold in Celsius to activate fans in occupied rooms
const float DEFAULT_TEMP_THRESHOLD = 26.0;

// Occupancy hold timer (in milliseconds):
// Keeps lights/fans active after motion is detected. Prevents flickering
// when occupants are sitting quietly at desks.
const unsigned long OCCUPANCY_HOLD_MS = 30000; // 30 seconds

// Servo Curtain Settings
const int SERVO_CLOSED_ANGLE = 0; // Curtains Closed (0 deg)
const int SERVO_OPEN_ANGLE = 80; // Curtains Open (90 deg)
const int SERVO_SPEED_MS = 30;    // Milliseconds per degree sweep
const unsigned long SERVO_IDLE_DETACH =
    800; // Detach PWM after movement to prevent buzzing

// Sensor Update Frequencies (Non-blocking)
const unsigned long DHT_READ_INTERVAL_MS = 2500; // Read DHT every 2.5 seconds
const unsigned long OLED_REFRESH_MS = 1000; // Refresh display every 1.0 second

// ==========================================
// --- ESTIMATED POWER RATINGS (WATTS) ---
// Used to compute live kW load matching the mobile app telemetry
// ==========================================
const float WATTS_CLASS_LIGHT = 60.0;
const float WATTS_CLASS_FAN = 75.0;
const float WATTS_CORR_LIGHT = 40.0;
const float WATTS_SERVO_ACTIVE = 5.0;

#endif // CONFIG_H
