/*
 * K-Track Vehicle Tracker Firmware  v3.6.0
 * ESP32 + MPU6050 + SIMCom A7608E-H (4G LTE + GNSS)
 *
 * - MPU6050 at 100 Hz on core 0 with bias calibration and crash detection; a
 *   crash is sent as crash:true on the next GPS record.
 * - GNSS via AT+CGNSSINFO; clock set from GPS time, UTC, milliseconds.
 * - One JSON record every 5 s sent live over HTTPS (modem's own HTTP client).
 *   After 5 failed sends in a row the backend counts as down: records are
 *   then written to a flash buffer every 5 min and sent once it's back.
 * - OTA updates checked every minute, downloaded in 16 KB pieces, SHA-256
 *   verified, with rollback if the new firmware fails its start-up checks.
 *
 * Wiring: MPU6050 SDA->GPIO21, SCL->GPIO22. A7608E-H TX->GPIO16, RX->GPIO17.
 * Arduino IDE: "ESP32 Dev Module", partition "Default 4MB with spiffs",
 * Serial Monitor 115200. Library: ArduinoJson.
 * Full documentation: README.md.
 */

#include <Arduino.h>
#include <Wire.h>
#include <Update.h>
#include <LittleFS.h>
#include <time.h>
#include <math.h>
#include <ArduinoJson.h>
#include "esp_ota_ops.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include "mbedtls/sha256.h"

/* ============================== CONFIGURATION ============================== */
const char* FW_VERSION    = "3.6.2";
const char* DEVICE_ID     = "TRK-0001";
// AUTH_TOKEN is defined in secrets.h (not committed; copy secrets.example.h).
#include "secrets.h"

// Backend host: VS Code dev tunnel for testing, Render when deployed.
const char* TELEMETRY_URL    = "https://d6v0336q-33430.inc1.devtunnels.ms/api/tracker-data";
const char* OTA_MANIFEST_URL = "https://d6v0336q-33430.inc1.devtunnels.ms/api/firmware/latest";
// Render: "https://k-track-api.onrender.com/api/tracker-data" / ".../api/firmware/latest"
const char* APN              = "jazz";

// Feature switches (turn off to bench-test without the backend).
bool FEATURE_TELEMETRY_SEND = true;
bool FEATURE_OTA            = true;

// Pins and buses
const int      PIN_I2C_SDA  = 21;
const int      PIN_I2C_SCL  = 22;
const int      PIN_MODEM_RX = 16;
const int      PIN_MODEM_TX = 17;
const uint32_t MODEM_BAUD   = 115200;
const size_t   MODEM_RX_BUF = 4096;   // room for 1 KB AT+HTTPREAD chunks
const uint32_t I2C_CLOCK_HZ = 400000;

// Scheduling
const uint32_t IMU_PERIOD_MS             = 10;                    // 100 Hz
const uint32_t REPORT_PERIOD_MS          = 5000;
const uint32_t TELEMETRY_PERIOD_MS       = 5000;                 // connected
const uint32_t OFFLINE_RECORD_PERIOD_MS  = 5UL * 60UL * 1000UL;   // no connection
const uint32_t OTA_PERIOD_MS             = 1UL * 60UL * 1000UL;   // 1 min - change the OTA time here
const uint32_t LOOP_IDLE_MS              = 10;
const uint32_t BUFFER_FULL_SLEEP_MS      = 5UL * 60UL * 1000UL;   // light sleep while full

// Offline buffer: JSON-Lines segment files of RECORDS_PER_FILE records, capped
// at about 1 MB. A stored record is at most ~159 B; budgeting 160 B gives 66 files =
// 6600 records, about 22.9 days of outage at one record per 5 min.
const uint32_t BUFFER_MAX_BYTES    = 1024UL * 1024UL;   // 1 MB
const uint32_t AVG_RECORD_BYTES    = 160UL;
const uint32_t RECORDS_PER_FILE    = 100;
const uint32_t BUFFER_CAPACITY     = BUFFER_MAX_BYTES / AVG_RECORD_BYTES;
const uint32_t BUFFER_MAX_FILES    = (BUFFER_CAPACITY + RECORDS_PER_FILE - 1) / RECORDS_PER_FILE;
const uint32_t CURSOR_SAVE_EVERY   = 10;      // sent records between cursor saves
const uint32_t FAIL_STREAK_LIMIT   = 5;       // failed sends in a row before going offline
const char*    BUFFER_DIR          = "/kbuf";
const uint32_t DRAIN_MAX_PER_PASS  = 3;       // records per loop pass
const uint32_t DRAIN_BUDGET_MS     = 4000;    // keeps reports flowing
// Reconnect probes while offline: RETRY_FAST_COUNT at RETRY_FAST_MS, then RETRY_SLOW_MS.
const uint32_t RETRY_FAST_MS       = 5000;    // 5 s
const uint32_t RETRY_FAST_COUNT    = 5;
const uint32_t RETRY_SLOW_MS       = 300000;  // 300 s

// Pre-check timing
const uint32_t MODEM_READY_ATTEMPTS = 10;
const uint32_t NETWORK_WAIT_MS      = 60000;
const uint32_t GNSS_READY_WAIT_MS   = 15000;
const uint32_t GNSS_INFO_WINDOW_MS  = 15000;
const uint32_t GNSS_INFO_POLL_MS    = 3000;
const uint32_t DATA_RETRY_MS        = 60000;   // re-attach data if IP lost


// Modem HTTP(S) timing
const uint32_t HTTP_POST_WAIT_MS    = 30000;   // +HTTPACTION after a POST
const uint32_t HTTP_GET_WAIT_MS     = 60000;   // +HTTPACTION after a GET
const uint32_t HTTP_READ_WAIT_MS    = 10000;   // one AT+HTTPREAD chunk
const size_t   MANIFEST_MAX_BYTES   = 2048;

// MPU6050: accelerometer +/-16 g, gyro +/-1000 deg/s, so an impact doesn't clip.
const uint8_t  MPU_ADDR           = 0x68;
const uint8_t  MPU_REG_SMPLRT_DIV = 0x19;
const uint8_t  MPU_REG_CONFIG     = 0x1A;
const uint8_t  MPU_REG_GYRO_CFG   = 0x1B;
const uint8_t  MPU_REG_ACCEL_CFG  = 0x1C;
const uint8_t  MPU_REG_DATA_START = 0x3B;
const uint8_t  MPU_REG_PWR_MGMT_1 = 0x6B;
const uint8_t  MPU_REG_WHO_AM_I   = 0x75;
const size_t   MPU_DATA_BYTES     = 14;
const float    ACCEL_LSB_PER_G    = 2048.0f;   // +/-16 g
const float    GYRO_LSB_PER_DPS   = 32.8f;     // +/-1000 deg/s
const float    GRAVITY_MS2        = 9.80665f;
const float    DEG_TO_RADF        = 0.01745329252f;
const uint32_t IMU_REINIT_ERRORS  = 50;
const uint32_t MPU_CALIBRATION_MS = 5000;      // 5 s at rest - change the calibration time here

// Crash detection thresholds
const float    CRASH_ACCEL_MS2       = 4.0f * GRAVITY_MS2;   // 4 g = 39.2 m/s^2
const float    CRASH_GYRO_RADS       = 3.5f;
const float    CRASH_DELTA_ACCEL_MS2 = 15.0f;
const float    CRASH_DELTA_GYRO_RADS = 3.0f;
const uint32_t CRASH_COOLDOWN_MS     = 5000;

// OTA download: OTA_RANGE_BYTES per request, read from the modem and written
// to flash OTA_CHUNK_SIZE at a time; gives up after OTA_RANGE_RETRIES requests
// in a row without progress.
const size_t   OTA_CHUNK_SIZE    = 1024;
const size_t   OTA_RANGE_BYTES   = 16UL * 1024UL;   // 16 KB - change the OTA piece size here
const uint32_t OTA_RANGE_RETRIES = 3;

/* ================================== TYPES ================================== */
struct GnssFix {
  bool   valid = false;
  int    mode = 0;             // 2 = 2D fix, 3 = 3D fix
  int    satellites = 0;
  double latDeg = 0.0;
  double lonDeg = 0.0;
  float  altM = 0.0f;
  float  speedKmh = 0.0f;
  float  courseDeg = 0.0f;
  float  hdop = 0.0f;
  uint64_t utcMs = 0;          // fix time, UTC ms since 1970 (0 = unknown)
};

struct ImuSample {
  uint64_t monoMs = 0;            // monoMs() when read
  float ax = 0, ay = 0, az = 0;   // m/s^2
  float gx = 0, gy = 0, gz = 0;   // rad/s
  float accelMag = 0;
  float gyroMag = 0;
  float tempC = 0;
};

struct ImuFilter {
  bool     primed = false;         // false until the first sample is in
  bool     hasCrashed = false;
  uint64_t lastCrashMono = 0;
  uint32_t consecutiveErrors = 0;
  float    prevAccelMag = 0;
  float    prevGyroMag = 0;
};

// Sensor bias measured at start-up by mpuCalibrate(), subtracted from every reading.
struct ImuOffsets {
  float ax = 0, ay = 0, az = 0;
  float gx = 0, gy = 0, gz = 0;
};

struct ImuShared {
  ImuSample latest;
  ImuSample crash;
  bool      crashPending = false;
  uint32_t  samples = 0;
  uint32_t  i2cErrors = 0;
  uint32_t  crashes = 0;
};

struct CrashReport {
  bool      pending = false;
  bool      hasGnss = false;
  uint32_t  gnssAgeS = 0;
  ImuSample imu;
  GnssFix   gnss;
};

// One telemetry record. Both timestamps are UTC (whole seconds, in ms since 1970).
struct TelemetryRecord {
  uint64_t utcMs = 0;       // created_at: time of the GPS fix
  uint64_t espUtcMs = 0;    // recorded_at: ESP32 clock when the record was made
  int32_t  latE7 = 0;       // degrees x 1e7
  int32_t  lonE7 = 0;
  uint16_t speedX10 = 0;    // km/h x 10
  uint8_t  crash = 0;       // 1 = crash event
  uint8_t  hasFix = 0;      // 0 = crash before the first GPS fix
};

// Flash FIFO of segment files /kbuf/<seq>.jsonl. /kbuf/cursor stores
// "firstSeq,byteOffset,linesSent" so sending resumes after a power cut.
struct FlashBuffer {
  bool            ready = false;
  uint32_t        firstSeq = 1;        // oldest segment (being sent)
  uint32_t        lastSeq = 1;         // newest segment (appended to)
  uint32_t        lastLines = 0;       // records in the newest segment
  uint32_t        readOffset = 0;      // byte offset of next unsent line
  uint32_t        readLines = 0;       // lines already sent from firstSeq
  uint32_t        count = 0;           // unsent records
  uint32_t        refusedFull = 0;     // new records refused while full
  uint64_t        lastUtcMs = 0;       // newest timestamp queued (keeps order)
  uint32_t        pendingCursorSaves = 0;
  uint32_t        recovered = 0;       // unsent records found at start-up
  uint32_t        corruptSkipped = 0;
  uint32_t        writeErrors = 0;
  bool            cacheValid = false;  // oldest record already read
  uint32_t        cacheLen = 0;        // its line length including '\n'
  TelemetryRecord cache;
};

// online: records are sent live. offline: records go to flash and reconnect
// probes run. Starts online at boot.
struct LinkState {
  bool     online = true;
  uint32_t failStreak = 0;         // consecutive failed sends while online
  uint32_t offlineRetries = 0;     // failed reconnect probes since going offline
  uint32_t failedAtMs = 0;
  uint32_t backoffMs = 0;
  int      lastStatus = 0;
};

struct OtaManifest {
  String   version;
  String   url;
  uint32_t size = 0;
  String   sha256;
};

/* ============================ FILE-SCOPE STATE ============================= */
HardwareSerial& SerialAT = Serial2;

GnssFix      g_fix;
GnssFix      g_lastGoodFix;
uint32_t     g_lastGoodFixMs = 0;
bool         g_gnssResponding = false;
bool         g_timeSynced = false;  // clock set from GPS yet?
int64_t      g_timeOffsetMs = 0;    // UTC = monoMs() + g_timeOffsetMs
int          g_signalQuality = -1;
bool         g_networkReady = false;
String       g_modemIp = "none";
CrashReport  g_crash;
bool         g_crashAwaitingRecord = false;   // crash not yet carried by a record
ImuShared    g_imu;
ImuOffsets   g_imuOffsets;
portMUX_TYPE g_imuMux = portMUX_INITIALIZER_UNLOCKED;
bool         g_modemOk = false;
bool         g_simOk = false;
uint32_t     g_lastReportMs = 0;
uint32_t     g_lastReportImuCnt = 0;
uint32_t     g_lastTelemetryMs = 0;
uint32_t     g_lastOtaMs = 0;
uint32_t     g_lastDataRetryMs = 0;
uint32_t     g_telemetrySent = 0;
uint32_t     g_telemetryDropped = 0;
uint64_t     g_lastRecordUtcMs = 0;  // newest fix already recorded (dedup)
FlashBuffer  g_buffer;
bool         g_bufferFull = false;   // loop() sleeps instead of recording
LinkState    g_link;

// Tell the Arduino core not to auto-accept new firmware after an OTA update;
// otaConfirmOrRollback() decides using the start-up check result instead.
extern "C" bool verifyRollbackLater(void);
extern "C" bool verifyRollbackLater(void) { return true; }

bool timeElapsed(uint32_t now, uint32_t since, uint32_t period) {
  return (uint32_t)(now - since) >= period;   // wrap-safe
}

/* ================================== TIME ==================================== */
// All times are UTC milliseconds since 1970, sent as "YYYY-MM-DDTHH:MM:SS.mmmZ".

// Monotonic milliseconds since boot. 64-bit (esp_timer), so unlike millis()
// it never wraps, and it keeps counting through light sleep.
uint64_t monoMs(void) {
  return (uint64_t)(esp_timer_get_time() / 1000);
}

long daysFromCivil(int year, int month, int day) {
  const int  y   = (month <= 2) ? (year - 1) : year;
  const int  era = ((y >= 0) ? y : (y - 399)) / 400;
  const long yoe = (long)(y - (era * 400));
  const long mp  = (month > 2) ? (month - 3) : (month + 9);
  const long doy = ((153 * mp + 2) / 5) + day - 1;
  const long doe = (yoe * 365) + (yoe / 4) - (yoe / 100) + doy;
  return ((long)era * 146097L) + doe - 719468L;
}

int twoDigits(const String& s, int pos) {
  return (s[pos] - '0') * 10 + (s[pos + 1] - '0');
}

int64_t civilToMs(long days, int hh, int mm, int ss, int ms) {
  int64_t secs = (int64_t)days * 86400 + (int64_t)hh * 3600 + (int64_t)mm * 60 + ss;
  return secs * 1000 + ms;
}

// Digits after the decimal point ("0", "25", "125", ...) -> milliseconds.
int fractionToMs(const String& frac) {
  int ms = 0;
  int scale = 100;
  for (int i = 0; i < (int)frac.length() && scale > 0; i++) {
    char c = frac[i];
    if (c < '0' || c > '9') break;
    ms += (c - '0') * scale;
    scale /= 10;
  }
  return ms;
}

// date "ddmmyy", time "hhmmss.s" -> UTC ms, or 0 if malformed.
uint64_t gnssParseUtcMs(const String& date, const String& hms) {
  if (date.length() < 6 || hms.length() < 6) return 0;
  int day = twoDigits(date, 0), mon = twoDigits(date, 2), yr = twoDigits(date, 4);
  int hh  = twoDigits(hms, 0),  mm  = twoDigits(hms, 2),  ss = twoDigits(hms, 4);
  if (day < 1 || day > 31 || mon < 1 || mon > 12 || hh > 23 || mm > 59 || ss > 60) return 0;
  int ms = (hms.length() > 7 && hms[6] == '.') ? fractionToMs(hms.substring(7)) : 0;
  return (uint64_t)civilToMs(daysFromCivil(2000 + yr, mon, day), hh, mm, ss, ms);
}

// ISO-8601 time -> UTC ms, or 0 if malformed. Accepts "YYYY-MM-DDTHH:MM:SS",
// an optional fraction, then "Z" or "+hh:mm"/"-hh:mm". Older records in the
// buffer were written as "...+05:00" (3.3), "....mmm+05:00" (3.4) or "...Z".
uint64_t parseIsoTime(const String& s) {
  if (s.length() < 20 || s[4] != '-' || s[7] != '-' || s[10] != 'T' ||
      s[13] != ':' || s[16] != ':') {
    return 0;
  }
  int year = s.substring(0, 4).toInt();
  int mon  = s.substring(5, 7).toInt();
  int day  = s.substring(8, 10).toInt();
  int hh   = s.substring(11, 13).toInt();
  int mm   = s.substring(14, 16).toInt();
  int ss   = s.substring(17, 19).toInt();
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || hh > 23 || mm > 59 || ss > 60) return 0;

  int pos = 19;
  int ms = 0;
  if (s[pos] == '.') {
    int end = pos + 1;
    while (end < (int)s.length() && isdigit(s[end])) end++;
    ms = fractionToMs(s.substring(pos + 1, end));
    pos = end;
  }
  int64_t offsetMs = 0;
  if (s[pos] == '+' || s[pos] == '-') {
    if ((int)s.length() != pos + 6 || s[pos + 3] != ':') return 0;
    int offMin = s.substring(pos + 1, pos + 3).toInt() * 60 + s.substring(pos + 4, pos + 6).toInt();
    offsetMs = (int64_t)offMin * 60000 * (s[pos] == '+' ? 1 : -1);
  } else if (s[pos] != 'Z' || (int)s.length() != pos + 1) {
    return 0;
  }
  return (uint64_t)(civilToMs(daysFromCivil(year, mon, day), hh, mm, ss, ms) - offsetMs);
}

// Sets the clock from a GPS fix: UTC = monoMs() + g_timeOffsetMs.
void clockSync(uint64_t fixUtcMs, uint64_t receivedMono) {
  if (fixUtcMs == 0) return;
  g_timeOffsetMs = (int64_t)fixUtcMs - (int64_t)receivedMono;
  g_timeSynced = true;
}

// UTC ms at a given monotonic instant, or 0 before the first GPS time.
uint64_t utcAtMono(uint64_t mono) {
  if (!g_timeSynced) return 0;
  return (uint64_t)((int64_t)mono + g_timeOffsetMs);
}

uint64_t currentUtcMs(void) {
  return utcAtMono(monoMs());
}

// UTC ms -> "2026-09-19T13:00:00.123Z".
void formatUtc(uint64_t utcMs, char* out, size_t cap) {
  if (utcMs == 0) { snprintf(out, cap, "unknown"); return; }
  time_t secs = (time_t)(utcMs / 1000);
  struct tm parts;
  gmtime_r(&secs, &parts);
  char base[24];
  strftime(base, sizeof(base), "%Y-%m-%dT%H:%M:%S", &parts);
  snprintf(out, cap, "%s.%03uZ", base, (unsigned)(utcMs % 1000));
}

/* ============================= MODEM (RAW AT) ============================== */
// All modem traffic runs from loop() (core 1) over Serial2. No modem library.

void atFlushInput(void) {
  while (SerialAT.available()) { SerialAT.read(); }
}

// True once the response holds a final result: OK, ERROR, +CME/+CMS ERROR.
bool atFinalResult(const String& resp) {
  if (!resp.endsWith("\r\n")) return false;
  return resp.endsWith("OK\r\n") || resp.indexOf("ERROR") >= 0;
}

// Sends one command and returns everything received up to the final result
// (or until timeout).
String atCommand(const String& cmd, uint32_t timeoutMs = 3000) {
  atFlushInput();
  SerialAT.print(cmd);
  SerialAT.print('\r');
  String resp;
  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    while (SerialAT.available()) {
      resp += (char)SerialAT.read();
      if (atFinalResult(resp)) return resp;
    }
    delay(1);
  }
  return resp;
}

bool atOk(const String& cmd, uint32_t timeoutMs = 3000) {
  String resp = atCommand(cmd, timeoutMs);
  return resp.indexOf("OK\r\n") >= 0 && resp.indexOf("ERROR") < 0;
}

// Returns the text after "<prefix>" on its line, e.g. "+CSQ:" -> " 20,99".
bool atQuery(const String& cmd, const String& prefix, String& value, uint32_t timeoutMs = 3000) {
  String resp = atCommand(cmd, timeoutMs);
  int p = resp.indexOf(prefix);
  if (p < 0) return false;
  int e = resp.indexOf('\r', p);
  value = resp.substring(p + prefix.length(), (e >= 0) ? e : resp.length());
  value.trim();
  return true;
}

// Waits for a line starting with `prefix` (skips other lines).
bool waitForLine(const String& prefix, uint32_t timeoutMs, String& line) {
  String buf;
  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    while (SerialAT.available()) {
      char c = (char)SerialAT.read();
      if (c == '\n') {
        buf.trim();
        if (buf.startsWith(prefix)) { line = buf; return true; }
        buf = "";
      } else if (c != '\r') {
        buf += c;
      }
    }
  }
  return false;
}

void modemInit(void) {
  atOk("ATE0");          // no command echo (keeps parsing simple)
  atOk("AT+CMEE=2");     // readable +CME ERROR text
}

bool modemSimReady(void) {
  for (int i = 0; i < 5; i++) {
    String v;
    if (atQuery("AT+CPIN?", "+CPIN:", v) && v.startsWith("READY")) return true;
    delay(1000);
  }
  return false;
}

// "+CEREG: <n>,<stat>" -> stat. 1 = home, 5 = roaming.
int modemRegStatus(const char* cmd, const char* prefix) {
  String v;
  if (!atQuery(cmd, prefix, v)) return -1;
  int comma = v.indexOf(',');
  return (comma >= 0) ? v.substring(comma + 1).toInt() : -1;
}

bool modemNetworkRegistered(void) {
  int eps = modemRegStatus("AT+CEREG?", "+CEREG:");   // LTE
  if (eps == 1 || eps == 5) return true;
  int ps = modemRegStatus("AT+CGREG?", "+CGREG:");    // 2G/3G packet
  return ps == 1 || ps == 5;
}

bool modemWaitForNetwork(uint32_t timeoutMs) {
  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    if (modemNetworkRegistered()) return true;
    delay(1000);
  }
  return false;
}

// "+CSQ: <rssi>,<ber>" -> rssi (0-31, 99 = unknown)
int modemSignalQuality(void) {
  String v;
  if (!atQuery("AT+CSQ", "+CSQ:", v)) return -1;
  return v.toInt();
}

// "+CGPADDR: 1,10.23.4.5" -> "10.23.4.5", or "none"
String modemLocalIp(void) {
  String v;
  if (!atQuery("AT+CGPADDR=1", "+CGPADDR:", v)) return "none";
  int comma = v.indexOf(',');
  if (comma < 0) return "none";
  String ip = v.substring(comma + 1);
  ip.replace("\"", "");
  ip.trim();
  return (ip.length() < 7 || ip == "0.0.0.0") ? "none" : ip;
}

// Defines PDP context 1 with the APN and activates it.
bool modemDataConnect(const char* apn) {
  atOk(String("AT+CGDCONT=1,\"IP\",\"") + apn + "\"");
  String ip = modemLocalIp();
  if (ip == "none") {
    atOk("AT+CGACT=1,1", 30000);
    ip = modemLocalIp();
  }
  g_modemIp = ip;
  return ip != "none";
}

// SSL context 0, used by the HTTP(S) client via AT+HTTPPARA="SSLCFG",0.
void modemConfigureTls(void) {
  atOk("AT+CSSLCFG=\"sslversion\",0,4");   // TLS 1.0-1.2 (any)
  atOk("AT+CSSLCFG=\"authmode\",0,0");     // encrypt, don't verify chain
  atOk("AT+CSSLCFG=\"enableSNI\",0,1");    // send host name (Render needs it)
}

/* ============================ MODEM HTTP(S) ================================ */
// Opens an HTTP session (end it with httpEnd()). USERDATA holds only the
// Authorization header: the modem sends a "\r\n" typed into it literally, so
// a second header can't be added. The OTA byte range goes in the URL instead.
bool httpBegin(const String& url) {
  atCommand("AT+HTTPTERM", 1000);   // close any leftover session (ERROR is ok)
  if (!atOk("AT+HTTPINIT", 5000)) return false;
  bool ok = atOk("AT+HTTPPARA=\"URL\",\"" + url + "\"");
  String header = String("Authorization: Bearer ") + AUTH_TOKEN;
  ok = ok && atOk("AT+HTTPPARA=\"USERDATA\",\"" + header + "\"");
  if (url.startsWith("https://")) atOk("AT+HTTPPARA=\"SSLCFG\",0");
  return ok;
}

void httpEnd(void) {
  atCommand("AT+HTTPTERM", 3000);
}

// Runs AT+HTTPACTION=<method> and parses "+HTTPACTION: <m>,<status>,<len>".
// Status >= 600 are modem-side errors (DNS, TLS, timeout...).
int httpAction(int method, uint32_t waitMs, uint32_t& bodyLen) {
  bodyLen = 0;
  atFlushInput();
  SerialAT.printf("AT+HTTPACTION=%d\r", method);
  String line;
  if (!waitForLine("+HTTPACTION:", waitMs, line)) return -4;
  int c1 = line.indexOf(',');
  int c2 = line.indexOf(',', c1 + 1);
  if (c1 < 0 || c2 < 0) return -5;
  bodyLen = (uint32_t)line.substring(c2 + 1).toInt();
  return line.substring(c1 + 1, c2).toInt();
}

// Reads `want` bytes of the response body starting at `offset`.
// Reply: OK / +HTTPREAD: <n> / <n raw bytes> / +HTTPREAD: 0
bool httpReadChunk(uint32_t offset, uint8_t* buf, size_t want, size_t& got) {
  got = 0;
  atFlushInput();
  SerialAT.printf("AT+HTTPREAD=%lu,%u\r", (unsigned long)offset, (unsigned)want);
  String line;
  if (!waitForLine("+HTTPREAD:", HTTP_READ_WAIT_MS, line)) {
    Serial.println("[HTTP]  AT+HTTPREAD: no reply from the modem");
    return false;
  }
  size_t n = (size_t)line.substring(10).toInt();   // after "+HTTPREAD:"
  if (n == 0 || n > want) {
    Serial.printf("[HTTP]  AT+HTTPREAD: unexpected reply '%s'\r\n", line.c_str());
    return false;
  }
  uint32_t start = millis();
  while (got < n && millis() - start < HTTP_READ_WAIT_MS) {   // binary-safe
    if (SerialAT.available()) buf[got++] = (uint8_t)SerialAT.read();
  }
  String tail;
  waitForLine("+HTTPREAD: 0", 3000, tail);   // end-of-read marker
  return got == n;
}

/* ================================== GNSS =================================== */
// A76xx +CGNSSINFO: mode, satellite counts..., lat, N/S, lon, E/W, date, time,
// alt, speed(knots), course, PDOP, HDOP, VDOP. Firmware variants differ in how
// many satellite-count fields precede latitude, so the N/S field is located
// first and every other field is read relative to it.
bool gnssParseInfo(const String& resp, GnssFix& fix) {
  int idx = resp.indexOf("+CGNSSINFO:");
  if (idx < 0) return false;
  String line = resp.substring(idx + 11);
  int end = line.indexOf('\r');
  if (end >= 0) line = line.substring(0, end);
  line.trim();

  const int MAX_FIELDS = 24;
  String fields[MAX_FIELDS];
  int count = 0;
  int start = 0;
  for (int i = 0; i <= line.length() && count < MAX_FIELDS; i++) {
    if (i == line.length() || line[i] == ',') {
      fields[count++] = line.substring(start, i);
      start = i + 1;
    }
  }

  int h = -1;
  for (int i = 2; i + 2 < count; i++) {
    bool isNs = (fields[i] == "N") || (fields[i] == "S");
    bool isEw = (fields[i + 2] == "E") || (fields[i + 2] == "W");
    if (isNs && isEw) { h = i; break; }
  }
  if (h < 2 || h + 9 >= count) return false;   // no fix

  fix = GnssFix();
  fix.mode = fields[0].toInt();
  for (int i = 1; i < h - 1; i++) { fix.satellites += fields[i].toInt(); }
  fix.latDeg = fields[h - 1].toDouble();
  fix.lonDeg = fields[h + 1].toDouble();
  if (fields[h] == "S") fix.latDeg = -fix.latDeg;
  if (fields[h + 2] == "W") fix.lonDeg = -fix.lonDeg;
  fix.utcMs     = gnssParseUtcMs(fields[h + 3], fields[h + 4]);
  fix.altM      = fields[h + 5].toFloat();
  fix.speedKmh  = fields[h + 6].toFloat() * 1.852f;   // knots -> km/h
  fix.courseDeg = fields[h + 7].toFloat();
  fix.hdop      = fields[h + 9].toFloat();
  bool inRange = fabs(fix.latDeg) <= 90.0 && fabs(fix.lonDeg) <= 180.0;
  bool nonZero = fix.latDeg != 0.0 || fix.lonDeg != 0.0;
  fix.valid = (fix.mode == 2 || fix.mode == 3) && inRange && nonZero && fix.utcMs > 0;
  return fix.valid;
}

// receivedMono: monoMs() the moment the AT+CGNSSINFO answer arrived.
void gnssAccept(const GnssFix& fix, uint64_t receivedMono) {
  g_fix = fix;
  g_lastGoodFix = fix;
  g_lastGoodFixMs = millis();
  clockSync(fix.utcMs, receivedMono);
}

void gnssPoll(void) {
  String resp = atCommand("AT+CGNSSINFO");
  uint64_t receivedMono = monoMs();
  g_gnssResponding = resp.indexOf("OK") >= 0;
  GnssFix fix;
  if (g_gnssResponding && gnssParseInfo(resp, fix)) {
    gnssAccept(fix, receivedMono);
  } else {
    g_fix.valid = false;
  }
}

bool gnssPowerOn(void) {
  String resp = atCommand("AT+CGNSSPWR=1", 3000);
  if (resp.indexOf("READY") >= 0) return true;
  String line;
  if (waitForLine("+CGNSSPWR: READY", GNSS_READY_WAIT_MS, line)) return true;
  String state = atCommand("AT+CGNSSPWR?", 2000);
  return state.indexOf("+CGNSSPWR: 1") >= 0;
}

/* ============================ MPU6050 DRIVER =============================== */
bool mpuWriteReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission(true) == 0;
}

bool mpuReadRegs(uint8_t reg, uint8_t* out, size_t n) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, (uint8_t)n) != n) return false;
  for (size_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

// 100 Hz output, 94 Hz low-pass, +/-1000 deg/s, +/-16 g
bool mpuConfigure(void) {
  bool ok = mpuWriteReg(MPU_REG_PWR_MGMT_1, 0x01);   // wake, gyro X clock
  delay(10);
  ok = ok && mpuWriteReg(MPU_REG_SMPLRT_DIV, 9);     // 1 kHz / (1 + 9)
  ok = ok && mpuWriteReg(MPU_REG_CONFIG, 0x02);      // DLPF ~94 Hz
  ok = ok && mpuWriteReg(MPU_REG_GYRO_CFG, 0x10);    // +/-1000 deg/s
  ok = ok && mpuWriteReg(MPU_REG_ACCEL_CFG, 0x18);   // AFS_SEL=3 -> +/-16 g
  return ok;
}

int16_t toInt16(uint8_t hi, uint8_t lo) {
  return (int16_t)(((uint16_t)hi << 8) | (uint16_t)lo);
}

// Applies g_imuOffsets (zero until mpuCalibrate() has run, so this is a
// no-op raw read during calibration itself).
bool mpuReadSample(ImuSample& s) {
  uint8_t b[MPU_DATA_BYTES];
  if (!mpuReadRegs(MPU_REG_DATA_START, b, sizeof(b))) return false;
  const float aScale = GRAVITY_MS2 / ACCEL_LSB_PER_G;
  const float gScale = DEG_TO_RADF / GYRO_LSB_PER_DPS;
  s.monoMs = monoMs();
  s.ax    = toInt16(b[0], b[1]) * aScale - g_imuOffsets.ax;
  s.ay    = toInt16(b[2], b[3]) * aScale - g_imuOffsets.ay;
  s.az    = toInt16(b[4], b[5]) * aScale - g_imuOffsets.az;
  s.tempC = (toInt16(b[6], b[7]) / 340.0f) + 36.53f;
  s.gx    = toInt16(b[8], b[9]) * gScale - g_imuOffsets.gx;
  s.gy    = toInt16(b[10], b[11]) * gScale - g_imuOffsets.gy;
  s.gz    = toInt16(b[12], b[13]) * gScale - g_imuOffsets.gz;
  s.accelMag = sqrtf(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
  s.gyroMag  = sqrtf(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz);
  return true;
}

float mpuRestMagnitude(void) {
  float sum = 0.0f;
  int n = 0;
  for (int i = 0; i < 20; i++) {
    ImuSample s;
    if (mpuReadSample(s)) { sum += s.accelMag; n++; }
    delay(10);
  }
  return (n > 0) ? (sum / n) : 0.0f;
}

// Averages MPU_CALIBRATION_MS of readings taken at rest. At rest the gyro
// should read 0 and the accelerometer +/-1 g on the gravity axis and 0 on the
// other two; the difference is the sensor's bias.
void mpuCalibrate(ImuOffsets& off) {
  double sumAx = 0, sumAy = 0, sumAz = 0, sumGx = 0, sumGy = 0, sumGz = 0;
  int n = 0;
  uint32_t start = millis();
  while (millis() - start < MPU_CALIBRATION_MS) {
    ImuSample s;
    if (mpuReadSample(s)) {   // g_imuOffsets is still all-zero here: this is raw
      sumAx += s.ax; sumAy += s.ay; sumAz += s.az;
      sumGx += s.gx; sumGy += s.gy; sumGz += s.gz;
      n++;
    }
    delay(4);
  }
  if (n == 0) return;
  float avgAx = sumAx / n, avgAy = sumAy / n, avgAz = sumAz / n;
  off.gx = sumGx / n;
  off.gy = sumGy / n;
  off.gz = sumGz / n;

  // The axis with the largest reading is the one gravity acts on.
  float mag[3] = { fabsf(avgAx), fabsf(avgAy), fabsf(avgAz) };
  int gravAxis = 0;
  if (mag[1] > mag[gravAxis]) gravAxis = 1;
  if (mag[2] > mag[gravAxis]) gravAxis = 2;
  float avg[3]    = { avgAx, avgAy, avgAz };
  float target[3] = { 0.0f, 0.0f, 0.0f };
  target[gravAxis] = (avg[gravAxis] >= 0.0f) ? GRAVITY_MS2 : -GRAVITY_MS2;
  off.ax = avg[0] - target[0];
  off.ay = avg[1] - target[1];
  off.az = avg[2] - target[2];
}

/* ============================== IMU TASK (core 0) ========================== */
// Crash rule: high acceleration AND high/sudden rotation, or a sudden
// acceleration change AND high rotation. One event per impact (cool-down).
bool imuDetectCrash(ImuFilter& f, const ImuSample& s) {
  bool crash = false;
  if (f.primed) {
    const bool hiAccel     = s.accelMag > CRASH_ACCEL_MS2;
    const bool hiGyro      = s.gyroMag > CRASH_GYRO_RADS;
    const bool suddenAccel = fabsf(s.accelMag - f.prevAccelMag) > CRASH_DELTA_ACCEL_MS2;
    const bool suddenGyro  = fabsf(s.gyroMag - f.prevGyroMag) > CRASH_DELTA_GYRO_RADS;
    const bool impact = (hiAccel && hiGyro) || (hiAccel && suddenGyro) || (suddenAccel && hiGyro);
    const bool cooled = !f.hasCrashed || (s.monoMs - f.lastCrashMono) >= CRASH_COOLDOWN_MS;
    crash = impact && cooled;
  }
  if (crash) { f.hasCrashed = true; f.lastCrashMono = s.monoMs; }
  f.prevAccelMag = s.accelMag;
  f.prevGyroMag  = s.gyroMag;
  return crash;
}

void imuPublish(const ImuSample& s, bool readOk, bool crash) {
  portENTER_CRITICAL(&g_imuMux);
  if (readOk) {
    g_imu.latest = s;
    g_imu.samples++;
    if (crash) {
      g_imu.crashes++;
      if (!g_imu.crashPending) { g_imu.crash = s; g_imu.crashPending = true; }
    }
  } else {
    g_imu.i2cErrors++;
  }
  portEXIT_CRITICAL(&g_imuMux);
}

void imuStep(ImuFilter& f) {
  ImuSample s;
  if (!mpuReadSample(s)) {
    f.consecutiveErrors++;
    if (f.consecutiveErrors >= IMU_REINIT_ERRORS) {
      mpuConfigure();               // recovery: re-initialise
      f.consecutiveErrors = 0;
    }
    imuPublish(s, false, false);
    return;
  }
  f.consecutiveErrors = 0;
  bool crash = imuDetectCrash(f, s);
  f.primed = true;
  imuPublish(s, true, crash);
}

void imuTask(void* param) {
  (void)param;
  ImuFilter filter;
  TickType_t lastWake = xTaskGetTickCount();
  for (;;) {
    imuStep(filter);
    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(IMU_PERIOD_MS));
  }
}

void imuSnapshot(ImuShared& out) {
  portENTER_CRITICAL(&g_imuMux);
  out = g_imu;
  portEXIT_CRITICAL(&g_imuMux);
}

bool imuTakeCrash(ImuSample& out) {
  bool taken = false;
  portENTER_CRITICAL(&g_imuMux);
  if (g_imu.crashPending) { out = g_imu.crash; g_imu.crashPending = false; taken = true; }
  portEXIT_CRITICAL(&g_imuMux);
  return taken;
}

bool imuStart(void) {
  return xTaskCreatePinnedToCore(imuTask, "imu", 4096, NULL, 3, NULL, 0) == pdPASS;
}

/* ============================ START-UP CHECKS =============================== */
bool g_criticalOk = true;

void checkPrint(const char* label, bool pass, bool critical, const String& detail) {
  Serial.printf("  [%-6s] %-4s  %s\r\n", label, pass ? "PASS" : (critical ? "FAIL" : "WARN"), detail.c_str());
  if (!pass && critical) g_criticalOk = false;
}

void checkFlash(void) {
  bufferMount();
  if (!g_buffer.ready) {
    checkPrint("FLASH", false, false, "LittleFS mount failed: data not buffered");
  } else {
    String detail = String(g_buffer.recovered) + " unsent record(s), " +
                    (LittleFS.usedBytes() / 1024) + "/" +
                    (LittleFS.totalBytes() / 1024) + " KB used";
    checkPrint("FLASH", true, false, detail);
  }
}

void checkMpu(void) {
  uint8_t who = 0;
  bool present = mpuReadRegs(MPU_REG_WHO_AM_I, &who, 1);
  bool configured = present && mpuConfigure();
  if (configured) {
    Serial.printf("          calibrating MPU6050 for %lu s (keep the vehicle still)...\r\n",
                  (unsigned long)(MPU_CALIBRATION_MS / 1000));
    mpuCalibrate(g_imuOffsets);
  }
  float rest = configured ? mpuRestMagnitude() : 0.0f;
  if (!present) {
    checkPrint("MPU", false, true, "not found at 0x68 (check SDA=21, SCL=22, power)");
  } else if (!configured) {
    checkPrint("MPU", false, true, "answered but configuration failed");
  } else {
    // With the bias removed, rest should be very close to 9.81 m/s^2.
    bool ok = rest > 9.5f && rest < 10.1f;
    checkPrint("MPU", ok, false, "WHO_AM_I 0x" + String(who, HEX) + ", calibrated rest " + String(rest, 2) +
               " m/s^2, gyro bias " + String(g_imuOffsets.gx, 3) + "/" + String(g_imuOffsets.gy, 3) +
               "/" + String(g_imuOffsets.gz, 3) + " rad/s");
  }
}

void checkModem(void) {
  bool ok = false;
  for (uint32_t i = 0; i < MODEM_READY_ATTEMPTS && !ok; i++) {
    ok = atOk("AT", 500);
    if (!ok) delay(500);
  }
  g_modemOk = ok;
  checkPrint("MODEM", ok, true, ok ? "responding" : "no reply (check TX->D16, RX->D17, power)");
  if (ok) modemInit();
}

void checkSim(void) {
  g_simOk = g_modemOk && modemSimReady();
  checkPrint("SIM", g_simOk, true, g_simOk ? "ready" : "not ready (inserted? PIN locked?)");
}

void checkNetwork(void) {
  if (!g_simOk) { checkPrint("NET", false, false, "skipped: no SIM"); return; }
  Serial.println("          ...waiting for network registration");
  g_networkReady = modemWaitForNetwork(NETWORK_WAIT_MS);
  g_signalQuality = modemSignalQuality();
  checkPrint("NET", g_networkReady, false,
             "registered=" + String(g_networkReady ? "yes" : "no") + ", signal " + g_signalQuality);
}

void checkGprs(void) {
  if (!g_networkReady) { checkPrint("GPRS", false, false, "skipped: not registered"); return; }
  bool ok = modemDataConnect(APN);   // sets g_modemIp
  checkPrint("GPRS", ok, false, ok ? ("attached, IP " + g_modemIp) : "APN attach failed (check APN/data balance)");
}

void checkGnss(void) {
  if (!gnssPowerOn()) { checkPrint("GNSS", false, false, "did not power on"); return; }
  bool fixed = false;
  GnssFix fix;
  uint64_t receivedMono = 0;
  uint32_t polls = GNSS_INFO_WINDOW_MS / GNSS_INFO_POLL_MS;
  for (uint32_t i = 0; i < polls && !fixed; i++) {
    String resp = atCommand("AT+CGNSSINFO");
    receivedMono = monoMs();
    g_gnssResponding = resp.indexOf("OK") >= 0;
    fixed = g_gnssResponding && gnssParseInfo(resp, fix);
    if (!fixed) delay(GNSS_INFO_POLL_MS);
  }
  if (fixed) {
    gnssAccept(fix, receivedMono);
    checkPrint("GNSS", true, false, String(fix.mode) + "D fix, " + fix.satellites + " sats, " +
               String(fix.latDeg, 6) + ", " + String(fix.lonDeg, 6));
  } else {
    checkPrint("GNSS", g_gnssResponding, false,
               g_gnssResponding ? "answering, no fix yet (normal indoors/cold start)" : "no answer");
  }
}

bool runStartupChecks(void) {
  g_criticalOk = true;
  checkFlash();
  checkMpu();
  bool imuRunning = imuStart();
  Serial.printf("          IMU task %s (100 Hz on core 0)\r\n", imuRunning ? "started" : "FAILED to start");
  checkModem();
  checkSim();
  checkNetwork();
  checkGprs();
  checkGnss();   // works without network/SIM
  Serial.println("  ------------------------------------------------------------------");
  Serial.println(g_criticalOk ? "  READY" : "  CRITICAL FAILURE (running in degraded mode)");
  Serial.println("  ==================================================================\r\n");
  return g_criticalOk;
}

/* ============================ JSON PAYLOADS ================================= */
// Record -> JSON. The wire payload (withDeviceId) is exactly: device_id,
// latitude, longitude, speed, crash, recorded_at, created_at. A buffered line
// leaves out device_id; it and the token are added only at send time.
bool recordToJson(const TelemetryRecord& r, bool withDeviceId, String& out) {
  StaticJsonDocument<320> doc;
  if (withDeviceId) doc["device_id"] = DEVICE_ID;
  if (r.hasFix) {
    doc["latitude"]  = r.latE7 / 1.0e7;
    doc["longitude"] = r.lonE7 / 1.0e7;
    doc["speed"]     = r.speedX10 / 10.0;
  } else {
    doc["latitude"]  = nullptr;
    doc["longitude"] = nullptr;
    doc["speed"]     = nullptr;
  }
  doc["crash"] = (bool)r.crash;
  char espTs[32];
  char gpsTs[32];
  formatUtc(r.espUtcMs, espTs, sizeof(espTs));
  formatUtc(r.utcMs, gpsTs, sizeof(gpsTs));
  doc["recorded_at"] = espTs;
  doc["created_at"]  = gpsTs;
  out = "";
  serializeJson(doc, out);
  return true;
}

bool bufferJsonToRecord(const String& line, TelemetryRecord& r) {
  StaticJsonDocument<288> doc;
  if (deserializeJson(doc, line)) return false;
  const char* gpsTs = doc["created_at"];
  if (!gpsTs) return false;
  uint64_t gpsUtcMs = parseIsoTime(String(gpsTs));
  if (gpsUtcMs == 0) return false;
  const char* espTs = doc["recorded_at"];
  uint64_t espUtcMs = espTs ? parseIsoTime(String(espTs)) : 0;
  if (espUtcMs == 0) espUtcMs = gpsUtcMs;  // tolerate an older/malformed line

  r = TelemetryRecord();
  r.utcMs = gpsUtcMs;
  r.espUtcMs = espUtcMs;
  r.crash = (doc["crash"] | false) ? 1 : 0;
  bool hasLat = !doc["latitude"].isNull();
  bool hasLon = !doc["longitude"].isNull();
  r.hasFix = (hasLat && hasLon) ? 1 : 0;
  if (r.hasFix) {
    double lat = doc["latitude"];
    double lon = doc["longitude"];
    double spd = doc["speed"] | 0.0;
    if (fabs(lat) > 90.0 || fabs(lon) > 180.0 || spd < 0.0 || spd > 6553.0) return false;
    r.latE7    = (int32_t)lround(lat * 1.0e7);
    r.lonE7    = (int32_t)lround(lon * 1.0e7);
    r.speedX10 = (uint16_t)lround(spd * 10.0);
  }
  return true;
}

/* ============================== HTTPS SEND =================================== */
// POSTs json. Returns the HTTP status, a modem error code (7xx) or a negative
// local error.
int httpsPostJson(const String& json) {
  if (!httpBegin(TELEMETRY_URL)) { httpEnd(); return -1; }
  atOk("AT+HTTPPARA=\"CONTENT\",\"application/json\"");

  // Body upload: modem answers DOWNLOAD, then takes exactly json.length() bytes
  atFlushInput();
  SerialAT.printf("AT+HTTPDATA=%u,10000\r", (unsigned)json.length());
  String line;
  if (!waitForLine("DOWNLOAD", 5000, line)) { httpEnd(); return -2; }
  SerialAT.print(json);
  if (!waitForLine("OK", 10000, line)) { httpEnd(); return -3; }

  uint32_t len = 0;
  int status = httpAction(1, HTTP_POST_WAIT_MS, len);   // 1 = POST
  httpEnd();
  return status;
}

/* ===================== OFFLINE BUFFER (FLASH, JSON-LINES) =================== */
String bufferPath(uint32_t seq) {
  char buf[32];
  snprintf(buf, sizeof(buf), "%s/%08lu.jsonl", BUFFER_DIR, (unsigned long)seq);
  return String(buf);
}

void bufferDeleteSegment(uint32_t seq) {
  String path = bufferPath(seq);
  if (LittleFS.exists(path) && !LittleFS.remove(path)) g_buffer.writeErrors++;
}

uint32_t bufferSegmentSize(uint32_t seq) {
  File f = LittleFS.open(bufferPath(seq), "r");
  uint32_t size = f ? f.size() : 0;
  if (f) f.close();
  return size;
}

void bufferSaveCursor(void) {
  String path = String(BUFFER_DIR) + "/cursor";
  String text = String(g_buffer.firstSeq) + "," + g_buffer.readOffset + "," + g_buffer.readLines + "\n";
  File f = LittleFS.open(path, "w");
  bool ok = f && f.print(text);
  if (f) f.close();
  if (!ok) g_buffer.writeErrors++;
  g_buffer.pendingCursorSaves = 0;
}

bool bufferLoadCursor(uint32_t& seq, uint32_t& offset, uint32_t& lines) {
  File f = LittleFS.open(String(BUFFER_DIR) + "/cursor", "r");
  if (!f) return false;
  String text = f.readStringUntil('\n');
  f.close();
  int c1 = text.indexOf(',');
  int c2 = text.indexOf(',', c1 + 1);
  if (c1 < 0 || c2 < 0) return false;
  seq    = text.substring(0, c1).toInt();
  offset = text.substring(c1 + 1, c2).toInt();
  lines  = text.substring(c2 + 1).toInt();
  return lines <= RECORDS_PER_FILE;
}

// Deletes the oldest segment once all its lines are sent and a newer segment
// exists.
void bufferReleaseConsumed(void) {
  if (g_buffer.firstSeq < g_buffer.lastSeq && g_buffer.readLines >= RECORDS_PER_FILE) {
    bufferDeleteSegment(g_buffer.firstSeq);
    g_buffer.firstSeq++;
    g_buffer.readOffset = 0;
    g_buffer.readLines = 0;
    g_buffer.cacheValid = false;
    bufferSaveCursor();
  }
}

// Boot only: trims a buffer that is over the cap (e.g. after an update
// lowered BUFFER_MAX_FILES). Normal recording never drops data.
void bufferDropOldestSegment(void) {
  uint32_t lost = (g_buffer.readLines < RECORDS_PER_FILE) ? (RECORDS_PER_FILE - g_buffer.readLines) : 0;
  g_buffer.count = (g_buffer.count > lost) ? (g_buffer.count - lost) : 0;
  bufferDeleteSegment(g_buffer.firstSeq);
  g_buffer.firstSeq++;
  g_buffer.readOffset = 0;
  g_buffer.readLines = 0;
  g_buffer.cacheValid = false;
  bufferSaveCursor();
}

// Appends one record as a JSON line. When full, the record is refused (old
// data is never overwritten) and loop() switches to bufferSleepCycle().
void bufferPush(const TelemetryRecord& r) {
  if (!g_buffer.ready) { g_buffer.writeErrors++; return; }
  if (g_buffer.lastLines >= RECORDS_PER_FILE) {   // would need a new segment
    if (g_buffer.lastSeq - g_buffer.firstSeq + 1 >= BUFFER_MAX_FILES) {
      if (!g_bufferFull) {
        Serial.println("[BUF]   buffer FULL: no more records stored until it drains");
      }
      g_buffer.refusedFull++;
      g_bufferFull = true;
      return;
    }
    g_buffer.lastSeq++;
    g_buffer.lastLines = 0;
    bufferReleaseConsumed();
  }
  String line;
  recordToJson(r, false, line);
  line += '\n';
  File f = LittleFS.open(bufferPath(g_buffer.lastSeq), "a");
  bool ok = f && f.print(line);
  if (f) f.close();
  if (!ok) { g_buffer.writeErrors++; return; }
  g_buffer.lastLines++;
  g_buffer.count++;
  g_buffer.lastUtcMs = r.utcMs;
}

// Reads the line at `offset` of segment `seq`. Returns bytes consumed
// including '\n', 0 at end of file, -1 if damaged (no newline found before
// EOF - an unfinished/corrupt write).
int bufferReadLine(uint32_t seq, uint32_t offset, String& line) {
  String path = bufferPath(seq);
  if (!LittleFS.exists(path)) return 0;
  File f = LittleFS.open(path, "r");
  if (!f) return -1;
  int result = 0;
  line = "";
  if (offset < f.size() && f.seek(offset)) {
    line = f.readStringUntil('\n');
    uint32_t consumed = f.position() - offset;
    result = (consumed == line.length() + 1) ? (int)consumed : -1;
  }
  f.close();
  return result;
}

// Recovery for a damaged segment: its remaining records are skipped.
void bufferSkipSegment(void) {
  uint32_t lines = (g_buffer.firstSeq < g_buffer.lastSeq) ? RECORDS_PER_FILE : g_buffer.lastLines;
  uint32_t lost = (lines > g_buffer.readLines) ? (lines - g_buffer.readLines) : 0;
  g_buffer.count = (g_buffer.count > lost) ? (g_buffer.count - lost) : 0;
  g_buffer.corruptSkipped += lost;
  g_buffer.readLines = lines;
  g_buffer.readOffset = bufferSegmentSize(g_buffer.firstSeq);
  g_buffer.cacheValid = false;
  Serial.printf("[BUF]   damaged segment %lu: %lu record(s) skipped\r\n",
                (unsigned long)g_buffer.firstSeq, (unsigned long)lost);
  bufferReleaseConsumed();
  bufferSaveCursor();
}

void bufferAdvance(uint32_t lineLen) {
  g_buffer.readOffset += lineLen;
  g_buffer.readLines++;
  g_buffer.count = (g_buffer.count > 0) ? (g_buffer.count - 1) : 0;
  g_buffer.cacheValid = false;
  g_buffer.pendingCursorSaves++;
  bufferReleaseConsumed();
  if (g_buffer.pendingCursorSaves >= CURSOR_SAVE_EVERY) bufferSaveCursor();
}

// Loads the oldest unsent record into the cache.
bool bufferLoadOldest(void) {
  String line;
  int used = bufferReadLine(g_buffer.firstSeq, g_buffer.readOffset, line);
  if (used == 0) {   // end of this segment
    if (g_buffer.firstSeq < g_buffer.lastSeq) {
      g_buffer.readLines = RECORDS_PER_FILE;
      bufferReleaseConsumed();
    } else {
      g_buffer.count = 0;   // recovery: resync
    }
    return false;
  }
  if (used < 0) { bufferSkipSegment(); return false; }
  if (!bufferJsonToRecord(line, g_buffer.cache)) {
    g_buffer.corruptSkipped++;
    bufferAdvance((uint32_t)used);   // skip one bad line
    return false;
  }
  g_buffer.cacheLen = (uint32_t)used;
  g_buffer.cacheValid = true;
  return true;
}

bool bufferPeekOldest(TelemetryRecord& out) {
  if (!g_buffer.ready || g_buffer.count == 0) return false;
  bool found = g_buffer.cacheValid;
  for (int attempt = 0; attempt < 4 && !found && g_buffer.count > 0; attempt++) {
    found = bufferLoadOldest();
  }
  if (found) out = g_buffer.cache;
  return found;
}

// Removes the oldest record after the backend confirmed it.
void bufferPopOldest(void) {
  if (!g_buffer.cacheValid || g_buffer.count == 0) return;
  bufferAdvance(g_buffer.cacheLen);
}

/* ------------------------- start-up recovery ------------------------------- */
void bufferScanSegments(uint32_t& minSeq, uint32_t& maxSeq, uint32_t& files) {
  minSeq = 0xFFFFFFFF;
  maxSeq = 0;
  files = 0;
  File dir = LittleFS.open(BUFFER_DIR);
  if (!dir || !dir.isDirectory()) return;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String name = f.name();
    int slash = name.lastIndexOf('/');
    String base = (slash >= 0) ? name.substring(slash + 1) : name;
    if (base.endsWith(".jsonl")) {
      uint32_t seq = (uint32_t)base.toInt();
      if (seq > 0) {
        minSeq = min(minSeq, seq);
        maxSeq = max(maxSeq, seq);
        files++;
      }
    }
    f.close();
  }
  dir.close();
}

// Counts complete lines in a segment and copies the last one into lastLine.
// An unterminated trailing line (write cut off by power loss) isn't counted.
uint32_t bufferCountLines(uint32_t seq, String& lastLine) {
  lastLine = "";
  uint32_t lines = 0;
  File f = LittleFS.open(bufferPath(seq), "r");
  if (!f) return 0;
  while (f.available()) {
    uint32_t before = f.position();
    String line = f.readStringUntil('\n');
    if (f.position() - before == line.length() + 1) {
      lastLine = line;
      lines++;
    }
  }
  f.close();
  return lines;
}

// Applies the saved cursor: segments before it were fully sent before power
// was lost and are deleted.
void bufferApplyCursor(void) {
  uint32_t seq = 0, offset = 0, lines = 0;
  if (bufferLoadCursor(seq, offset, lines) && seq >= g_buffer.firstSeq && seq <= g_buffer.lastSeq) {
    for (uint32_t s = g_buffer.firstSeq; s < seq; s++) bufferDeleteSegment(s);
    g_buffer.firstSeq = seq;
    g_buffer.readOffset = offset;
    g_buffer.readLines = lines;
  }
  while (g_buffer.lastSeq - g_buffer.firstSeq >= BUFFER_MAX_FILES) bufferDropOldestSegment();
}

// Rebuilds the unsent count and newest timestamp from the files.
void bufferRecount(void) {
  String last;
  g_buffer.count = 0;
  for (uint32_t s = g_buffer.firstSeq; s <= g_buffer.lastSeq; s++) {
    uint32_t lines = bufferCountLines(s, last);
    if (s == g_buffer.firstSeq) {
      g_buffer.count += (lines > g_buffer.readLines) ? (lines - g_buffer.readLines) : 0;
    } else {
      g_buffer.count += lines;
    }
    if (s == g_buffer.lastSeq) {
      g_buffer.lastLines = lines;
      TelemetryRecord r;
      if (last.length() > 0 && bufferJsonToRecord(last, r)) g_buffer.lastUtcMs = r.utcMs;
    }
  }
}

// Mounts LittleFS (formatting it on first use) and recovers the buffer.
void bufferMount(void) {
  g_buffer = FlashBuffer();
  if (!LittleFS.begin(true)) return;
  if (!LittleFS.exists(BUFFER_DIR)) LittleFS.mkdir(BUFFER_DIR);
  uint32_t minSeq, maxSeq, files;
  bufferScanSegments(minSeq, maxSeq, files);
  if (files == 0) {
    g_buffer.firstSeq = 1;
    g_buffer.lastSeq = 1;
  } else {
    g_buffer.firstSeq = minSeq;
    g_buffer.lastSeq = maxSeq;
  }
  g_buffer.ready = true;
  bufferApplyCursor();
  bufferRecount();
  bufferSaveCursor();
  g_buffer.recovered = g_buffer.count;
  g_bufferFull = (g_buffer.lastSeq - g_buffer.firstSeq + 1) >= BUFFER_MAX_FILES;
  g_lastRecordUtcMs = g_buffer.lastUtcMs;   // don't re-record a fix already queued before reboot
}

// Builds a record from the current GPS fix; there is no record without one.
// The crash flag is left false here - see takeCrashFlag().
bool telemetryMakeRecord(TelemetryRecord& out) {
  out = TelemetryRecord();
  if (!g_fix.valid) return false;
  uint64_t nowUtcMs = currentUtcMs();
  if (nowUtcMs == 0) return false;   // no GPS time yet
  out.utcMs = g_fix.utcMs;     // created_at
  out.espUtcMs = nowUtcMs;     // recorded_at
  out.hasFix = 1;
  float speed = (g_fix.speedKmh < 0.0f) ? 0.0f : g_fix.speedKmh;
  out.latE7 = (int32_t)lround(g_fix.latDeg * 1.0e7);
  out.lonE7 = (int32_t)lround(g_fix.lonDeg * 1.0e7);
  out.speedX10 = (speed > 6553.0f) ? 65530 : (uint16_t)lroundf(speed * 10.0f);
  return true;
}

// A detected crash waits in g_crashAwaitingRecord and is carried by the next
// GPS record that is sent or buffered (crash: true).
void takeCrashFlag(TelemetryRecord& r) {
  if (!g_crashAwaitingRecord) return;
  r.crash = 1;
  g_crashAwaitingRecord = false;
}

// Online: the record is sent live; if the send fails it is dropped and
// counted, and FAIL_STREAK_LIMIT failures in a row take the link offline.
// Offline: the record goes into the flash buffer. A record is skipped if the
// fix hasn't changed since the last one.
void telemetryEnqueue(void) {
  TelemetryRecord r;
  if (!telemetryMakeRecord(r)) return;
  if (r.utcMs <= g_lastRecordUtcMs) return;   // same fix as the previous record
  g_lastRecordUtcMs = r.utcMs;
  takeCrashFlag(r);

  if (!g_link.online || !linkNetworkReady()) {
    bufferPush(r);
    return;
  }

  String json;
  recordToJson(r, true, json);
  int status = httpsPostJson(json);
  if (statusDelivered(status)) {
    g_telemetrySent++;
    linkMarkSuccess(status);
    return;
  }

  if (r.crash) g_crashAwaitingRecord = true;   // the crash goes with the next record instead
  g_telemetryDropped++;
  g_link.failStreak++;
  Serial.printf("[TX]    live send failed (code %d): record dropped (failure %lu/%lu)\r\n",
                status, (unsigned long)g_link.failStreak, (unsigned long)FAIL_STREAK_LIMIT);
  if (g_link.failStreak >= FAIL_STREAK_LIMIT) {
    linkMarkFailure(status);   // go offline
  }
}

/* ============================ BACKEND LINK ================================= */
bool statusDelivered(int status) { return status >= 200 && status < 300; }

bool linkNetworkReady(void) { return g_networkReady && g_modemIp != "none"; }

// Offline: wait for the current retry interval before trying again.
bool linkMayAttempt(uint32_t now) {
  return g_link.online || timeElapsed(now, g_link.failedAtMs, g_link.backoffMs);
}

// Decides the recording rate: TELEMETRY_PERIOD_MS or OFFLINE_RECORD_PERIOD_MS.
bool telemetryConnected(void) {
  return FEATURE_TELEMETRY_SEND && linkNetworkReady() && g_link.online;
}

uint32_t telemetryRecordPeriod(void) {
  return telemetryConnected() ? TELEMETRY_PERIOD_MS : OFFLINE_RECORD_PERIOD_MS;
}

void linkMarkSuccess(int status) {
  if (!g_link.online) {
    Serial.printf("[LINK]  backend reachable again: live sending resumed, %lu buffered record(s) to drain\r\n",
                  (unsigned long)g_buffer.count);
  }
  g_link.online = true;
  g_link.failStreak = 0;
  g_link.offlineRetries = 0;
  g_link.lastStatus = status;
}

// Called on going offline and on every failed reconnect probe after that.
void linkMarkFailure(int status) {
  if (g_link.online) {
    g_link.offlineRetries = 0;   // just went offline: fast retries start over
  } else {
    g_link.offlineRetries++;
  }
  g_link.backoffMs = (g_link.offlineRetries < RETRY_FAST_COUNT) ? RETRY_FAST_MS : RETRY_SLOW_MS;
  g_link.online = false;
  g_link.failStreak = 0;
  g_link.failedAtMs = millis();
  g_link.lastStatus = status;
  Serial.printf("[LINK]  backend unreachable (code %d): buffering, retry %lu in %lu s\r\n",
                status, (unsigned long)(g_link.offlineRetries + 1), (unsigned long)(g_link.backoffMs / 1000));
}

// Reconnect probe with a fresh record when the buffer is empty. If it fails,
// the record is buffered like any other offline record.
void linkProbe(void) {
  TelemetryRecord r;
  if (!telemetryMakeRecord(r)) {   // no fix yet: try next interval
    g_link.failedAtMs = millis();
    return;
  }
  takeCrashFlag(r);
  String json;
  recordToJson(r, true, json);
  int status = httpsPostJson(json);
  if (r.utcMs > g_lastRecordUtcMs) g_lastRecordUtcMs = r.utcMs;
  if (statusDelivered(status)) {
    g_telemetrySent++;
    linkMarkSuccess(status);
    return;
  }
  bufferPush(r);
  linkMarkFailure(status);
}

// Sends buffered records oldest-first. Online: a failed record is skipped
// (and counts towards FAIL_STREAK_LIMIT). Offline: the first send is the
// reconnect probe, and a failed record is kept.
void telemetryDrainNormal(void) {
  uint32_t start = millis();
  bool keepGoing = true;
  for (uint32_t i = 0; i < DRAIN_MAX_PER_PASS && keepGoing && g_buffer.count > 0; i++) {
    TelemetryRecord r;
    String json;
    bool built = bufferPeekOldest(r) && recordToJson(r, true, json);
    bool wasOnline = g_link.online;
    int status = built ? httpsPostJson(json) : -1;
    bool delivered = statusDelivered(status);
    if (built && (delivered || wasOnline)) bufferPopOldest();   // offline probe keeps it
    if (delivered) {
      g_telemetrySent++;
      linkMarkSuccess(status);
    } else if (wasOnline) {
      g_telemetryDropped++;
      g_link.failStreak++;
      Serial.printf("[TX]    record failed (code %d): skipped, sending the next one\r\n", status);
      if (g_link.failStreak >= FAIL_STREAK_LIMIT) {
        linkMarkFailure(status);
        keepGoing = false;
      }
    } else {
      linkMarkFailure(status);   // still offline, record kept
      keepGoing = false;
    }
    keepGoing = keepGoing && (millis() - start) < DRAIN_BUDGET_MS;
  }
}

// Every loop pass. Online: drains any backlog. Offline: one reconnect probe
// per retry interval. No network counts as a failed probe (code -10).
void telemetryService(uint32_t now) {
  if (!linkMayAttempt(now)) return;
  if (g_link.online && g_buffer.count == 0) return;   // live mode, nothing to catch up on
  if (!linkNetworkReady()) {
    linkMarkFailure(-10);
    return;
  }
  if (g_buffer.count > 0) {
    telemetryDrainNormal();
  } else {
    linkProbe();
  }
}

/* ================================== OTA ==================================== */
bool otaFetchManifest(OtaManifest& m) {
  if (!httpBegin(OTA_MANIFEST_URL)) { httpEnd(); return false; }
  uint32_t len = 0;
  int status = httpAction(0, HTTP_GET_WAIT_MS, len);   // 0 = GET
  String body;
  if (status == 200 && len > 0 && len <= MANIFEST_MAX_BYTES) {
    uint8_t chunk[256];
    uint32_t total = 0;
    bool ok = true;
    while (ok && total < len) {
      size_t got = 0;
      size_t want = min((uint32_t)sizeof(chunk), len - total);
      ok = httpReadChunk(total, chunk, want, got);
      for (size_t i = 0; ok && i < got; i++) body += (char)chunk[i];
      total += got;
    }
  }
  httpEnd();
  // "0 announced" with HTTP 200 means the server sent no Content-Length.
  Serial.printf("[OTA] manifest HTTP %d, %lu bytes announced, %u read\r\n",
                status, (unsigned long)len, body.length());
  if (status != 200 || body.length() == 0) return false;

  StaticJsonDocument<384> doc;
  if (deserializeJson(doc, body)) return false;
  const char* v = doc["version"];
  const char* u = doc["url"];
  const char* s = doc["sha256"];
  if (!v || !u || !s) return false;
  m.version = v;
  m.url = u;
  m.sha256 = s;
  m.size = doc["size"] | 0;
  return m.size > 0;
}

// true if version a is newer than version b ("1.2.0" > "1.1.9")
bool otaIsNewer(const String& a, const String& b) {
  int a1, a2, a3, b1, b2, b3;
  if (sscanf(a.c_str(), "%d.%d.%d", &a1, &a2, &a3) != 3) return false;
  if (sscanf(b.c_str(), "%d.%d.%d", &b1, &b2, &b3) != 3) return false;
  if (a1 != b1) return a1 > b1;
  if (a2 != b2) return a2 > b2;
  return a3 > b3;
}

bool otaDigestMatches(const uint8_t* digest, const String& expectedHex) {
  char hex[65];
  for (int i = 0; i < 32; i++) snprintf(&hex[i * 2], 3, "%02x", digest[i]);
  bool match = expectedHex.equalsIgnoreCase(hex);
  if (!match) Serial.printf("[OTA] SHA-256 mismatch\r\n  got      %s\r\n  expected %s\r\n", hex, expectedHex.c_str());
  return match;
}

// Requests bytes [start, start+len) of the image ("<url>?range=a-b", answered
// with 206) and writes them to the OTA slot as they are read out of the modem,
// OTA_CHUNK_SIZE at a time, so no large RAM buffer is needed. Returns how many
// bytes were written; the caller carries on from there. flashOk turns false if
// writing to flash fails.
uint32_t otaFetchRange(const String& url, uint32_t start, uint32_t len,
                       mbedtls_sha256_context& sha, bool& flashOk) {
  String rangeUrl = url + ((url.indexOf('?') >= 0) ? "&" : "?") +
                    "range=" + String(start) + "-" + String(start + len - 1);
  if (!httpBegin(rangeUrl)) { httpEnd(); return 0; }
  uint32_t bodyLen = 0;
  int status = httpAction(0, HTTP_GET_WAIT_MS, bodyLen);   // 0 = GET
  if (status != 206 || bodyLen != len) {
    Serial.printf("[OTA] range %lu-%lu refused: HTTP %d, %lu bytes\r\n",
                  (unsigned long)start, (unsigned long)(start + len - 1), status, (unsigned long)bodyLen);
    httpEnd();
    return 0;
  }
  uint8_t chunk[OTA_CHUNK_SIZE];
  uint32_t done = 0;
  while (done < len) {
    size_t want = min((uint32_t)OTA_CHUNK_SIZE, len - done);
    size_t n = 0;
    if (!httpReadChunk(done, chunk, want, n)) break;
    if (Update.write(chunk, n) != n) { flashOk = false; break; }
    mbedtls_sha256_update(&sha, chunk, n);
    done += n;
  }
  httpEnd();
  return done;
}

// Downloads the image into the spare OTA slot, OTA_RANGE_BYTES per request,
// hashing it on the way. If a request stops early, the next one continues
// from the last byte written. Gives up after OTA_RANGE_RETRIES requests in a
// row that make no progress.
bool otaInstall(const OtaManifest& m) {
  if (m.size == 0) return false;
  if (!Update.begin((size_t)m.size, U_FLASH)) {
    Serial.printf("[OTA] image of %lu bytes does not fit the OTA slot\r\n", (unsigned long)m.size);
    return false;
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);   // 0 = SHA-256

  uint32_t total = 0;
  uint32_t failures = 0;
  bool flashOk = true;
  while (total < m.size && failures < OTA_RANGE_RETRIES && flashOk) {
    uint32_t len = min((uint32_t)OTA_RANGE_BYTES, m.size - total);
    uint32_t got = otaFetchRange(m.url, total, len, sha, flashOk);
    total += got;
    failures = (got == 0) ? failures + 1 : 0;
    if (got == len) {
      Serial.printf("[OTA] %lu / %lu bytes\r\n", (unsigned long)total, (unsigned long)m.size);
    } else {
      Serial.printf("[OTA] request stopped at %lu / %lu bytes (no progress %lu/%lu)\r\n",
                    (unsigned long)total, (unsigned long)m.size,
                    (unsigned long)failures, (unsigned long)OTA_RANGE_RETRIES);
    }
  }

  uint8_t digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);
  bool ok = flashOk && total == m.size && otaDigestMatches(digest, m.sha256);
  if (!ok) {
    Serial.printf("[OTA] download stopped at %lu / %lu bytes\r\n", (unsigned long)total, (unsigned long)m.size);
    Update.abort();   // old firmware stays
    return false;
  }
  return Update.end(true);   // boot new slot next
}

// Parked, good signal, no crash report pending and nothing buffered.
bool otaSafeToUpdate(void) {
  bool parked = g_fix.valid && g_fix.speedKmh < 3.0f;
  bool network = g_networkReady && g_signalQuality >= 10;
  return parked && network && !g_crash.pending && !g_crashAwaitingRecord && g_buffer.count == 0;
}

void otaCheck(void) {
  OtaManifest m;
  if (!otaFetchManifest(m)) { Serial.println("[OTA] could not read manifest"); return; }
  Serial.printf("[OTA] running %s, server has %s\r\n", FW_VERSION, m.version.c_str());
  if (!otaIsNewer(m.version, FW_VERSION)) { Serial.println("[OTA] up to date"); return; }
  if (!otaSafeToUpdate()) { Serial.println("[OTA] postponed: vehicle not parked or weak network"); return; }
  if (otaInstall(m)) {
    Serial.printf("[OTA] verified, rebooting into %s\r\n", m.version.c_str());
    delay(500);
    ESP.restart();
  }
}

// New firmware boots "on trial" and is kept only if the critical start-up
// checks (MPU, modem, SIM) passed; otherwise the previous firmware returns.
void otaConfirmOrRollback(bool checksOk) {
  const esp_partition_t* running = esp_ota_get_running_partition();
  if (!running) return;
  esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
  bool known = esp_ota_get_state_partition(running, &state) == ESP_OK;
  Serial.printf("[BOOT] firmware %s running from slot '%s'\r\n", FW_VERSION, running->label);
  if (known && state == ESP_OTA_IMG_PENDING_VERIFY) {
    if (checksOk) {
      esp_ota_mark_app_valid_cancel_rollback();
      Serial.println("[BOOT] new firmware passed its checks: update ACCEPTED");
    } else {
      Serial.println("[BOOT] new firmware failed its checks: ROLLING BACK");
      delay(500);
      esp_ota_mark_app_invalid_rollback_and_reboot();
    }
  } else {
    esp_ota_mark_app_valid_cancel_rollback();
  }
}

/* ============================ 5-SECOND REPORT ============================== */
// Every field AT+CGNSSINFO provides, one per line.
void reportGnss(void) {
  Serial.println("[GPS]   ---- GNSS (AT+CGNSSINFO) ----");
  if (g_fix.valid) {
    char ts[32];
    formatUtc(g_fix.utcMs, ts, sizeof(ts));
    Serial.printf("        Fix type    : %dD fix\r\n", g_fix.mode);
    Serial.printf("        Satellites  : %d\r\n", g_fix.satellites);
    Serial.printf("        Latitude    : %.6f deg\r\n", g_fix.latDeg);
    Serial.printf("        Longitude   : %.6f deg\r\n", g_fix.lonDeg);
    Serial.printf("        Altitude    : %.1f m\r\n", g_fix.altM);
    Serial.printf("        Speed       : %.1f km/h\r\n", g_fix.speedKmh);
    Serial.printf("        Course      : %.1f deg\r\n", g_fix.courseDeg);
    Serial.printf("        HDOP        : %.1f\r\n", g_fix.hdop);
    Serial.printf("        Fix time    : %s\r\n", ts);
  } else if (g_lastGoodFix.valid) {
    Serial.println("        Fix type    : NONE (no current fix)");
    Serial.printf("        Last fix    : %.6f, %.6f deg (%lu s ago)\r\n",
                  g_lastGoodFix.latDeg, g_lastGoodFix.lonDeg,
                  (unsigned long)((millis() - g_lastGoodFixMs) / 1000));
  } else {
    Serial.printf("        Fix type    : NONE (GNSS %s)\r\n",
                  g_gnssResponding ? "answering, no fix yet" : "NOT answering");
  }
  if (g_timeSynced) {
    char now[32];
    formatUtc(currentUtcMs(), now, sizeof(now));
    Serial.printf("        ESP32 clock : %s (set from GPS)\r\n", now);
  } else {
    Serial.println("        ESP32 clock : not set yet (waits for the first GPS time)");
  }
}

void reportImu(const ImuShared& imu, uint32_t now) {
  uint32_t dtMs = now - g_lastReportMs;
  uint32_t dn = imu.samples - g_lastReportImuCnt;
  float rate = (dtMs > 0) ? (dn * 1000.0f / dtMs) : 0.0f;
  const ImuSample& s = imu.latest;
  Serial.printf("[IMU]   rate %.1f Hz  |a| %.2f m/s^2  |g| %.2f rad/s\r\n",
                rate, s.accelMag, s.gyroMag);
  Serial.printf("        a(x,y,z) %.2f %.2f %.2f  g(x,y,z) %.2f %.2f %.2f  temp %.1f C  I2C errors %lu\r\n",
                s.ax, s.ay, s.az, s.gx, s.gy, s.gz, s.tempC, (unsigned long)imu.i2cErrors);
  g_lastReportImuCnt = imu.samples;
}

// "+CSQ: <rssi>" -> dBm (3GPP TS 27.007 mapping) and a plain-English label.
int signalDbm(int csq) {
  return (csq >= 0 && csq <= 31) ? (-113 + (2 * csq)) : 0;
}

const char* signalLabel(int csq) {
  if (csq < 0 || csq == 99) return "unknown / no reply";
  if (csq >= 20) return "excellent";
  if (csq >= 15) return "good";
  if (csq >= 10) return "fair";
  return "poor";
}

// Every field the modem's own status commands provide, one per line.
void reportNetwork(void) {
  Serial.println("[NET]   ---- modem / network ----");
  if (g_signalQuality < 0 || g_signalQuality == 99) {
    Serial.println("        Signal      : unknown / no reply");
  } else {
    Serial.printf("        Signal      : %d/31 (%d dBm, %s)\r\n",
                  g_signalQuality, signalDbm(g_signalQuality), signalLabel(g_signalQuality));
  }
  Serial.printf("        Registered  : %s\r\n", g_networkReady ? "yes" : "no");
  Serial.printf("        IP address  : %s\r\n", g_modemIp.c_str());
}

void reportCrash(const ImuShared& imu) {
  if (!g_crash.pending) {
    Serial.printf("[CRASH] none since last report (total %lu)\r\n", (unsigned long)imu.crashes);
    return;
  }
  const ImuSample& c = g_crash.imu;
  Serial.printf("[CRASH] !!! CRASH EVENT at %lu s since boot (total %lu) !!!\r\n",
                (unsigned long)(c.monoMs / 1000), (unsigned long)imu.crashes);
  Serial.printf("        |a| %.2f m/s^2  |g| %.2f rad/s  a(x,y,z) %.2f %.2f %.2f\r\n",
                c.accelMag, c.gyroMag, c.ax, c.ay, c.az);
  Serial.printf("        g(x,y,z) %.2f %.2f %.2f  temp %.1f C\r\n",
                c.gx, c.gy, c.gz, c.tempC);
  if (g_crash.hasGnss) {
    Serial.printf("        location %.6f, %.6f (fix %lu s old at crash)\r\n",
                  g_crash.gnss.latDeg, g_crash.gnss.lonDeg, (unsigned long)g_crash.gnssAgeS);
  } else {
    Serial.println("        location unknown (no GPS fix yet)");
  }
  g_crash.pending = false;
}

void reportJson(void) {
  TelemetryRecord r;
  String json;
  if (telemetryMakeRecord(r) && recordToJson(r, true, json)) {
    Serial.printf("[JSON]  %s\r\n", json.c_str());
  } else {
    Serial.println("[JSON]  no record this cycle (needs a GPS fix and GPS time)");
  }
}

void reportBuffer(uint32_t now) {
  char newest[32];
  uint32_t n = g_buffer.count;
  uint32_t permille = (n * 1000) / (BUFFER_MAX_FILES * RECORDS_PER_FILE);
  if (g_buffer.lastUtcMs > 0) formatUtc(g_buffer.lastUtcMs, newest, sizeof(newest));
  else snprintf(newest, sizeof(newest), "-");
  Serial.printf("[BUF]   FLASH %s  %lu unsent record(s) (%lu.%lu%% full)  segments %lu-%lu  newest %s\r\n",
                g_buffer.ready ? "OK" : "UNAVAILABLE", (unsigned long)n, (unsigned long)(permille / 10),
                (unsigned long)(permille % 10), (unsigned long)g_buffer.firstSeq, (unsigned long)g_buffer.lastSeq, newest);
  bool connected = telemetryConnected();
  Serial.printf("        recording every %lu s (%s)\r\n",
                (unsigned long)(telemetryRecordPeriod() / 1000), connected ? "connected" : "no connection");
  TelemetryRecord r;
  String line;
  if (bufferPeekOldest(r) && recordToJson(r, false, line)) {
    Serial.printf("        oldest unsent: %s\r\n", line.c_str());
  }
  Serial.printf("        recovered at boot %lu  refused (full) %lu  corrupt skipped %lu  write errors %lu\r\n",
                (unsigned long)g_buffer.recovered, (unsigned long)g_buffer.refusedFull,
                (unsigned long)g_buffer.corruptSkipped, (unsigned long)g_buffer.writeErrors);
  if (!FEATURE_TELEMETRY_SEND) {
    Serial.println("        sending DISABLED: records stay in flash (test mode)");
  } else if (g_link.online) {
    Serial.printf("        backend ONLINE (last HTTP %d)  sent %lu  failed+skipped %lu\r\n", g_link.lastStatus,
                  (unsigned long)g_telemetrySent, (unsigned long)g_telemetryDropped);
  } else {
    uint32_t waited = now - g_link.failedAtMs;
    uint32_t left = (waited < g_link.backoffMs) ? (g_link.backoffMs - waited) / 1000 : 0;
    Serial.printf("        backend OFFLINE (last code %d): buffering, next try in %lu s  sent %lu\r\n",
                  g_link.lastStatus, (unsigned long)left, (unsigned long)g_telemetrySent);
  }
}

void reportSystem(void) {
  Serial.printf("[SYS]   fw %s  heap %lu B (min %lu B)  OTA %s\r\n",
                FW_VERSION, (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getMinFreeHeap(),
                FEATURE_OTA ? "ENABLED" : "DISABLED");
}

void reportPrint(uint32_t now) {
  ImuShared imu;
  imuSnapshot(imu);
  Serial.printf("\r\n=================== K-TRACK STATUS  (uptime %lu s) ===================\r\n",
                (unsigned long)(now / 1000));
  reportGnss();
  reportImu(imu, now);
  reportNetwork();
  reportJson();
  reportBuffer(now);
  reportCrash(imu);   // prints, then clears
  reportSystem();
  Serial.println("======================================================================");
}

/* ============================== MAIN LOOP ================================== */
// Runs instead of the normal loop while the buffer is full: one reconnect
// attempt, then resume if the backend answered or room was freed, otherwise
// light-sleep BUFFER_FULL_SLEEP_MS. Light sleep also pauses crash detection.
void bufferSleepCycle(void) {
  if (g_modemOk) {
    g_signalQuality = modemSignalQuality();
    g_networkReady = modemNetworkRegistered();
    g_modemIp = g_networkReady ? modemLocalIp() : String("none");
    if (linkNetworkReady()) telemetryService(millis());
  }
  bool hasRoom = (g_buffer.lastSeq - g_buffer.firstSeq + 1) < BUFFER_MAX_FILES;
  if (g_link.online || hasRoom) {
    g_bufferFull = false;
    Serial.println(g_link.online ? "[BUF]   backend reachable again: resuming normal operation"
                                 : "[BUF]   buffer has room again: resuming normal operation");
    return;
  }
  Serial.printf("[BUF]   buffer full: sleeping %lu s before the next attempt\r\n",
                (unsigned long)(BUFFER_FULL_SLEEP_MS / 1000));
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)BUFFER_FULL_SLEEP_MS * 1000ULL);
  esp_light_sleep_start();
}

// Takes a crash from the IMU task: prepares the Serial report and flags it
// for the next GPS record (see takeCrashFlag()).
void crashService(void) {
  ImuSample s;
  if (!imuTakeCrash(s)) return;
  g_crashAwaitingRecord = true;
  if (g_crash.pending) {
    Serial.println("[CRASH] further impact detected before the report");
    return;
  }
  g_crash.pending = true;
  g_crash.imu = s;
  g_crash.gnss = g_lastGoodFix;
  g_crash.hasGnss = g_lastGoodFix.valid;
  g_crash.gnssAgeS = g_crash.hasGnss ? (millis() - g_lastGoodFixMs) / 1000 : 0;
  Serial.printf("\r\n!!! CRASH DETECTED (|a| %.1f m/s^2, |g| %.1f rad/s) - sent with the next GPS record !!!\r\n",
                s.accelMag, s.gyroMag);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\r\n\r\n==================================================================");
  Serial.printf("  K-Track tracker firmware v%s   device %s\r\n", FW_VERSION, DEVICE_ID);
  Serial.println("==================================================================");

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_CLOCK_HZ);
  Wire.setTimeOut(20);
  SerialAT.setRxBufferSize(MODEM_RX_BUF);   // must come before begin()
  SerialAT.begin(MODEM_BAUD, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);
  delay(500);

  Serial.println("\r\n  ===================== START-UP CHECKS =====================");
  bool checksOk = runStartupChecks();

  otaConfirmOrRollback(checksOk);
  if (g_modemOk && (FEATURE_TELEMETRY_SEND || FEATURE_OTA)) {
    modemConfigureTls();   // SSL context 0 for the modem's HTTPS client
  }

  uint32_t now = millis();
  g_lastReportMs = now;
  g_lastTelemetryMs = now;
  g_lastOtaMs = now - OTA_PERIOD_MS;   // first OTA check right away
}

void loop() {
  if (g_bufferFull) {
    bufferSleepCycle();
    return;
  }
  crashService();
  uint32_t now = millis();
  if (timeElapsed(now, g_lastReportMs, REPORT_PERIOD_MS)) {
    gnssPoll();
    g_signalQuality = modemSignalQuality();
    g_networkReady = modemNetworkRegistered();
    g_modemIp = g_networkReady ? modemLocalIp() : String("none");
    reportPrint(now);
    g_lastReportMs = now;
  }
  // Re-attach mobile data if it was never up or has been lost.
  if (g_modemOk && g_networkReady && g_modemIp == "none" &&
      timeElapsed(now, g_lastDataRetryMs, DATA_RETRY_MS)) {
    g_lastDataRetryMs = now;
    bool up = modemDataConnect(APN);
    Serial.printf("[NET]   mobile data %s  IP %s\r\n", up ? "attached" : "attach FAILED", g_modemIp.c_str());
  }
  if (timeElapsed(now, g_lastTelemetryMs, telemetryRecordPeriod())) {
    g_lastTelemetryMs = now;
    telemetryEnqueue();   // 5 s connected (live), 5 min offline (buffered)
  }
  if (FEATURE_TELEMETRY_SEND) {
    telemetryService(millis());   // backlog drain / reconnect probes
  }
  if (FEATURE_OTA && timeElapsed(now, g_lastOtaMs, OTA_PERIOD_MS)) {
    g_lastOtaMs = now;
    otaCheck();
  }
  delay(LOOP_IDLE_MS);
}
