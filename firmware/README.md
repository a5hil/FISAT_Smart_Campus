# FISAT Smart Campus - ESP32 Dual-Classroom Controller Firmware

Production firmware for driving **two smart classrooms (Classroom A101 & Classroom A102)** plus **corridor lighting** using a single **ESP32 DevKit** micro-controller. 

This firmware integrates directly with the **FISAT Smart Campus Management System** React Native mobile app.

---

## 1. System Features

- **Dual-Zone Control**: Manages Classroom 1 (`cls-a101`) and Classroom 2 (`cls-a102`) simultaneously.
- **Smart Occupancy Management**: Dual PIR sensors with software debounced hold timer (30s) prevents lights/fans from flickering off when students are seated.
- **Climate Automation**: Shared DHT11 sensor automatically engages ceiling fans when a room is occupied and temperature exceeds threshold (26°C).
- **Daylight-Harvesting Corridor Lighting**: Dual LDR light sensors automatically illuminate hallway lights when ambient lux drops below threshold.
- **Motorized Curtains**: Dual SG90/MG90S servo motors with smooth sweep and auto-detach to prevent jitter, buzzing, and servo overheating.
- **Real-Time Telemetry & Load Estimation**: Calculates live electrical load (Watts) in real-time matching the mobile app's energy dashboard.
- **OLED Local Display**: 0.96" SSD1306 display showing live Wi-Fi IP, Mode, Room Occupancy, and Relay Statuses.
- **Dual-Layer REST API**:
  - Legacy endpoints: `/status`, `/ctrl?dev=...&st=...`, `/mode?auto=...`
  - Enhanced JSON REST API: `/api/status`, `/api/control`, `/api/config`
- **Embedded Web Dashboard**: Self-hosted responsive mobile-ready web app accessible at `http://<ESP32-IP>/` or `http://esp32-classroom.local`.

---

## 2. Hardware Pinout & Wiring Table

| ESP32 GPIO | Subsystem / Zone | Connected Hardware | Component Pin | Function / Logic |
| :--- | :--- | :--- | :--- | :--- |
| **GPIO 21** | Shared Display | 0.96" OLED SSD1306 | SDA | I2C Data line |
| **GPIO 22** | Shared Display | 0.96" OLED SSD1306 | SCL | I2C Clock line |
| **GPIO 4** | Shared Climate | DHT11 / DHT22 Sensor | DATA / OUT | Temp & Humidity Data (10k pullup) |
| **GPIO 32** | Classroom 1 (A101) | PIR Motion Sensor 1 | OUT | High = Motion detected |
| **GPIO 25** | Classroom 1 (A101) | Relay Channel 1 | IN1 | Main Classroom Lights (Active LOW) |
| **GPIO 27** | Classroom 1 (A101) | Relay Channel 2 | IN2 | Ceiling Fan (Active LOW) |
| **GPIO 18** | Classroom 1 (A101) | SG90 Servo Motor 1 | PWM (Orange/Yellow) | Curtain Actuator (0°-90°) |
| **GPIO 33** | Classroom 2 (A102) | PIR Motion Sensor 2 | OUT | High = Motion detected |
| **GPIO 26** | Classroom 2 (A102) | Relay Channel 3 | IN3 | Main Classroom Lights (Active LOW) |
| **GPIO 14** | Classroom 2 (A102) | Relay Channel 4 | IN4 | Ceiling Fan (Active LOW) |
| **GPIO 19** | Classroom 2 (A102) | SG90 Servo Motor 2 | PWM (Orange/Yellow) | Curtain Actuator (0°-90°) |
| **GPIO 34** | Corridors / Shared | LDR Light Sensor 1 | Analog AO (ADC1_CH6) | Ambient light measurement |
| **GPIO 35** | Corridors / Shared | LDR Light Sensor 2 | Analog AO (ADC1_CH7) | Ambient light measurement |
| **GPIO 16** | Corridors / Shared | Relay Channel 5 | IN5 | Corridor Light 1 (Active LOW) |
| **GPIO 17** | Corridors / Shared | Relay Channel 6 | IN6 | Corridor Light 2 (Active LOW) |

> [!IMPORTANT]
> **Power Supply Recommendation**:
> - ESP32 runs on 3.3V logic.
> - The 6-Channel Relay board and SG90 Servos must be powered by an **external 5V 2A power supply** with a common GND connected to the ESP32 GND. Do NOT power 2 servos and 6 relays directly from the ESP32 3V3/VIN pin to avoid brownout resets!

---

## 3. Required Arduino Libraries

Install these libraries via the **Arduino Library Manager** (`Ctrl+Shift+I` or `Cmd+Shift+I`):

1. **Adafruit SSD1306** (v2.5.7 or newer)
2. **Adafruit GFX Library** (v1.11.5 or newer)
3. **DHT sensor library by Adafruit** (v1.4.4 or newer)
4. **Adafruit Unified Sensor** (dependency for DHT)
5. **ESP32Servo by Kevin Harrington** (v1.1.0 or newer)
6. **ArduinoJson by Benoit Blanchon** (v6.21.x or v7.x) — *Required for Supabase cloud sync*

---

## 4. Configuration & Flashing Guide

1. Open `firmware/esp32_smart_classroom/esp32_smart_classroom.ino` in Arduino IDE.
2. Open `config.h` and update your Wi-Fi credentials:
   ```cpp
   const char* const WIFI_SSID     = "Your_WiFi_Name";
   const char* const WIFI_PASSWORD = "Your_WiFi_Password";
   ```
3. In Arduino IDE:
   - **Tools > Board > esp32 > ESP32 Dev Module**
   - **Tools > Upload Speed > 921600** (or 115200)
   - **Tools > CPU Frequency > 240MHz**
   - **Tools > Flash Frequency > 80MHz**
   - **Tools > Port > Select your ESP32 COM Port**
4. Click **Upload**.
5. Open Serial Monitor at **115200 baud** to see the assigned IP address.

---

## 5. REST API Documentation

### 5.1 System Status
- **Endpoint**: `GET /status` or `GET /api/status`
- **Response**:
```json
{
  "status": "ok",
  "mode": "auto",
  "temperature": 27.2,
  "humidity": 55.0,
  "total_load_watts": 140.0,
  "classroom1": {
    "id": "cls-a101",
    "name": "Classroom A101",
    "room": "A101",
    "motion": true,
    "occupied": true,
    "light": true,
    "fan": true,
    "curtain": true,
    "curtain_angle": 90,
    "load_watts": 140.0
  },
  "classroom2": {
    "id": "cls-a102",
    "name": "Classroom A102",
    "room": "A102",
    "motion": false,
    "occupied": false,
    "light": false,
    "fan": false,
    "curtain": false,
    "curtain_angle": 0,
    "load_watts": 0.0
  },
  "corridors": {
    "ldr1_raw": 1450,
    "light1": false,
    "ldr2_raw": 2890,
    "light2": true
  },
  "controller": {
    "firmware": "2.2.0",
    "ip": "192.168.1.101",
    "rssi": -52,
    "uptime_sec": 482
  }
}
```

### 5.2 Device Control
- **Endpoint**: `GET /ctrl?dev=<ID>&st=<0|1>&force=1` or `POST /api/control`
- **Supported `dev` IDs**:
  - `l1` (Classroom 1 Light)
  - `f1` (Classroom 1 Fan)
  - `c1` (Classroom 1 Curtain)
  - `l2` (Classroom 2 Light)
  - `f2` (Classroom 2 Fan)
  - `c2` (Classroom 2 Curtain)
  - `cr1` (Corridor Light 1)
  - `cr2` (Corridor Light 2)
  - `all` (Emergency all on/off)
- **Examples**:
  ```bash
  # Turn on Classroom 1 Light
  curl "http://192.168.1.101/ctrl?dev=l1&st=1"

  # Open Classroom 2 Curtains
  curl "http://192.168.1.101/ctrl?dev=c2&st=1"

  # Emergency All Off
  curl "http://192.168.1.101/ctrl?dev=all&st=0&force=1"
  ```

### 5.3 Operating Mode Control
- **Endpoint**: `GET /mode?auto=1` (Auto) or `GET /mode?auto=0` (Manual)
  ```bash
  # Set to Manual Mode (disables automatic sensor overrides)
  curl "http://192.168.1.101/mode?auto=0"
  ```

### 5.4 Embedded Web Dashboard
Open your browser on any phone or laptop connected to the same Wi-Fi:
```
http://<ESP32-IP>/
or
http://esp32-classroom.local/
```
Provides live status gauges, room cards, toggle switches, and an **Emergency All Off** button.

---

## 6. Supabase Cloud Sync (Worldwide Remote 4G/5G Control)

The ESP32 is equipped with **bidirectional cloud synchronization** directly with the Supabase Postgres Database via HTTPS REST:

```
[Mobile App (Anywhere in World via 4G/5G)]
          │  ▲
          │  │  Supabase Realtime WebSockets
          ▼  │
   [Supabase Cloud Database]
          │  ▲
          │  │  HTTPS REST (Poll 1.0s / Telemetry 5.0s)
          ▼  │
[ESP32 Hardware Controller (Connected to Campus/Hotspot Wi-Fi)]
   ├── 6x Relays (Classroom & Corridor Lights/Fans)
   ├── 2x Servos (Motorized Curtains)
   └── Sensors (DHT11 Climate, PIR Occupancy, LDR Ambient Light)
```

### How Remote Control Works:
1. **App Action**: When a user on mobile data (4G/5G) taps a relay or curtain switch in the app, the app writes `status = 'on' | 'off'` to the `devices` table in Supabase.
2. **ESP32 Polling**: The ESP32 polls `GET /rest/v1/devices?select=id,status` every **1.0 second** via secure HTTPS.
3. **Physical Actuation**: The ESP32 parses the JSON with `ArduinoJson`, detects the requested state change, and immediately engages or disengages the corresponding relay or servo GPIO.
4. **Telemetry Push**: Every **5.0 seconds**, the ESP32 pushes live DHT11 temperature, humidity, and PIR room occupancy to the `classrooms` table in Supabase via `PATCH /rest/v1/classrooms`.
5. **Realtime Broadcast**: Supabase broadcasts the telemetry update via WebSocket to all connected smartphone apps anywhere in the world.

---

## 7. Live Presentation Demo Script

1. **Power-On & Boot**: Show the OLED display initializing, connecting to Wi-Fi, and showing its assigned IP address and `[CLD]` cloud sync indicator.
2. **Auto Mode Test - Classroom 1**:
   - Wave your hand over PIR1: Notice the OLED display changes to `C1:[OCC]`, Relay 1 clicks ON (Main Lights), and Servo 1 sweeps open to 90° (Curtains open).
   - If ambient temp is > 26°C (or exhale warm air on DHT11), Relay 2 clicks ON (Ceiling Fan).
   - Stop moving: The 30s hold timer counts down before gracefully turning devices off, proving realistic lecture room occupancy.
3. **Auto Mode Test - Corridors**:
   - Cover LDR1 with your finger: Relay 5 clicks ON (Corridor Light). Uncover it: turns OFF.
4. **Mobile App Manual Override (Local Wi-Fi or Remote 4G/5G)**:
   - Open the React Native app.
   - Toggle Classroom A101 Light or Corridor Light from the app screen.
   - The device state updates in Supabase and the ESP32 physically toggles the relay in real-time.
5. **Emergency Cut-off**:
   - Press the **Emergency All Off** button in the app or web dashboard: All 6 relays instantly de-energize and curtains close.
