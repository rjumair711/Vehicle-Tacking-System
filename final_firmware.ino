/*
 * K-Track vehicle tracker firmware v4.7.0
 * ESP32 + MPU6050 / MPU-6050 + SIMCom A7608E-H (LTE + GNSS)
 *
 * Boot : start-up checks (flash, MPU, modem, SIM, network, data, GNSS), MPU
 *        calibration loaded from NVS (5 s calibration and save if there is
 *        none: keep the vehicle still), OTA accept / rollback.
 * Loop : status report every 3 s; a GPS record every 3 s (every 30 s while
 *        the backend is down), stored in flash and posted oldest-first over
 *        HTTPS, one record per request (retried every 10 s while the backend
 *        is down); crash check; OTA check every 1 min. Buffer full and backend
 *        down = deep sleep for 1 min, then boot and try again.
 *
 * Provisioning, once per tracker (Serial Monitor 115200, line ending "Newline"):
 *     provision <device_id> <auth_token>
 * Stored in NVS, which OTA updates don't touch. Nothing is recorded or sent
 * until it is set. "calibrate" recalibrates the MPU (board still) and saves it.
 *
 * Library : ArduinoJson v6.21+ or v7 (everything else is in the ESP32 core).
 * Wiring  : MPU SDA -> GPIO21, SCL -> GPIO22. Modem TX -> GPIO16, RX -> GPIO17,
 *           common GND.
 * Board   : "ESP32 Dev Module", partition scheme "Default 4MB with spiffs".
 */

#include <Arduino.h>
#include <Wire.h>
#include <Update.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <time.h>
#include <math.h>
#include <ArduinoJson.h>
#include "esp_ota_ops.h"
#include "esp_sleep.h"
#include "mbedtls/sha256.h"

/* ============================== CONFIGURATION ============================== */
// Must be newer than the version the OTA server lists.
const char* FW_VERSION    = "5.0.0";

// Per-tracker identity in NVS (see provisioning above).
const char*  NVS_NAMESPACE      = "ktrack";
const char*  NVS_KEY_ID         = "dev_id";
const char*  NVS_KEY_TOKEN      = "auth_tok";
const size_t DEVICE_ID_MAX_LEN  = 32;
const size_t AUTH_TOKEN_MIN_LEN = 16;
const size_t AUTH_TOKEN_MAX_LEN = 128;
const char*  NVS_KEY_IMU_CAL    = "imu_cal2";  // saved MPU calibration (ImuOffsets)

const char* TELEMETRY_URL    = "https://ktrack-backend.onrender.com/api/tracker-data";
const char* OTA_MANIFEST_URL = "https://ktrack-backend.onrender.com/api/firmware/latest";
const char* APN              = "jazz";

bool FEATURE_OTA            = true;

// Pins and buses
const int      PIN_I2C_SDA  = 21;
const int      PIN_I2C_SCL  = 22;
const int      PIN_MODEM_RX = 16;
const int      PIN_MODEM_TX = 17;
const uint32_t MODEM_BAUD         = 460800;   // used after start-up
const uint32_t MODEM_FACTORY_BAUD = 115200;   // speed of a modem straight from the factory
const size_t   MODEM_RX_BUF = 4096;     // room for a 1 KB AT+HTTPREAD chunk
const uint32_t I2C_CLOCK_HZ = 400000;

// Scheduling
const uint32_t IMU_PERIOD_MS             = 10;                    // 100 Hz
const uint32_t REPORT_PERIOD_MS          = 3000;
const uint32_t TELEMETRY_PERIOD_MS       = 3000;                  // backend answering
const uint32_t OFFLINE_RECORD_PERIOD_MS  = 1UL * 30UL * 1000UL;   // backend not answering
const uint32_t RETRY_MS                  = 10000;                 // backend down: retry every 10 s
const uint32_t FULL_SLEEP_MS             = 60000;                 // buffer full + backend down: sleep 1 min, then retry
const uint32_t OTA_PERIOD_MS             = 1UL * 60UL * 1000UL;
const uint32_t LOOP_IDLE_MS              = 10;

// Flash buffer: JSON-Lines files of RECORDS_PER_FILE lines in BUFFER_DIR.
// BUFFER_MAX_FILES = 88 files x 100 = 8,800 records.
const uint32_t BUFFER_MAX_BYTES    = 1024UL * 1024UL;   // 1 MB
const uint32_t AVG_RECORD_BYTES    = 120UL;
const uint32_t RECORDS_PER_FILE    = 100;
const uint32_t BUFFER_CAPACITY     = BUFFER_MAX_BYTES / AVG_RECORD_BYTES;
const uint32_t BUFFER_MAX_FILES    = (BUFFER_CAPACITY + RECORDS_PER_FILE - 1) / RECORDS_PER_FILE;
const uint32_t CURSOR_SAVE_EVERY   = 10;      // sent records between cursor saves
const char*    BUFFER_DIR          = "/kbuf";
const uint32_t DRAIN_MAX_PER_PASS  = 3;       // records sent per loop pass
const uint32_t DRAIN_BUDGET_MS     = 4000;    // time allowed for them

// Start-up and data timing
const uint32_t MODEM_READY_ATTEMPTS = 10;
const uint32_t GNSS_READY_WAIT_MS   = 20000;   // wait for "+CGNSSPWR: READY!" after AT+CGNSSPWR=1
const uint32_t DATA_RETRY_MS        = 10000;   // re-attach data if the IP is lost

// Modem HTTP(S) timing
const uint32_t HTTP_POST_WAIT_MS    = 30000;
const uint32_t HTTP_GET_WAIT_MS     = 60000;
const uint32_t HTTP_READ_WAIT_MS    = 10000;
const size_t   MANIFEST_MAX_BYTES   = 1024;

// MPU: accelerometer +/-16 g, gyro +/-1000 deg/s.
const uint8_t  MPU_ADDR           = 0x68;
const uint8_t  MPU_REG_SMPLRT_DIV = 0x19;
const uint8_t  MPU_REG_CONFIG     = 0x1A;
const uint8_t  MPU_REG_GYRO_CFG   = 0x1B;
const uint8_t  MPU_REG_ACCEL_CFG  = 0x1C;
const uint8_t  MPU_REG_ACCEL_CFG2 = 0x1D;      // MPU-6500 family only
const uint8_t  MPU_REG_DATA_START = 0x3B;
const uint8_t  MPU_REG_PWR_MGMT_1 = 0x6B;
const uint8_t  MPU_REG_WHO_AM_I   = 0x75;
const size_t   MPU_DATA_BYTES     = 14;
const float    ACCEL_LSB_PER_G    = 2048.0f;   // +/-16 g
const float    GYRO_LSB_PER_DPS   = 32.8f;     // +/-1000 deg/s
const float    GRAVITY_MS2        = 9.80665f;
const float    DEG_TO_RADF        = 0.01745329252f;
const uint32_t IMU_REINIT_ERRORS  = 1;         // failed reads in a row before re-configuring and recalibrating
const uint32_t IMU_SETTLE_SAMPLES = 10;        // ignored after configuring (still at the +/-2 g scale)
const uint32_t MPU_CALIBRATION_MS = 5000;
const float    IMU_RECAL_MAX_KMH  = 3.0f;      // recover with recalibration only below this GPS speed
// A calibration counts as good (and is saved) only if the board was still:
const float    CAL_MIN_REST_G     = 0.9f;      // strength at rest at least this...
const float    CAL_MAX_REST_G     = 1.1f;      // ...and at most this
const float    CAL_MAX_GYRO_BIAS  = 0.2f;      // and gyro bias under this, rad/s

// Crash: impact = | |a| - 1 g | above CRASH_IMPACT_G on CRASH_MIN_SAMPLES
// samples in a row, then GPS speed below CRASH_STOP_KMH within
// CRASH_CONFIRM_WINDOW_MS. Impacts within CRASH_QUIET_MS of an alert are ignored.
const float    CRASH_IMPACT_G          = 2.5f;
const uint32_t CRASH_MIN_SAMPLES       = 2;        // 20 ms
const uint32_t CRASH_CONFIRM_WINDOW_MS = 10000;
const float    CRASH_STOP_KMH          = 5.0f;
const uint32_t CRASH_GPS_POLL_MS       = 1000;
const uint32_t CRASH_QUIET_MS          = 5000;

// OTA: image fetched in OTA_RANGE_BYTES HTTP Range requests, each read in
// OTA_CHUNK_SIZE pieces and retried up to OTA_RANGE_RETRIES times.
const size_t   OTA_CHUNK_SIZE    = 1024;
const size_t   OTA_RANGE_BYTES   = 48UL * 1024UL;   // 48 KB, also the size of the RAM buffer
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
  uint64_t utcMs = 0;          // UTC ms since 1970 (0 = unknown)
};

struct ImuSample {
  uint32_t tMs = 0;
  float ax = 0, ay = 0, az = 0;   // m/s^2
  float gx = 0, gy = 0, gz = 0;   // rad/s
  float accelMag = 0;             // m/s^2, gravity included
  float gyroMag = 0;
  float tempC = 0;
  float impactG = 0;              // | |a| - 1 g |, in g
};

// Calibration measured by mpuCalibrate(), applied in mpuReadSample().
struct ImuOffsets {
  float accelScale = 1.0f;        // multiplies all three accelerometer axes
  float gx = 0, gy = 0, gz = 0;   // gyro bias, subtracted
};

// IMU task's private state (core 0).
struct ImuFilter {
  uint32_t settle = IMU_SETTLE_SAMPLES;   // samples left before impacts count
  uint32_t consecutiveErrors = 0;
  uint32_t overCount = 0;         // samples in a row above CRASH_IMPACT_G
  float    runPeakG = 0;          // peak of the current run
};

// Shared by the IMU task (writer) and the main loop (reader), under g_imuMux.
struct ImuShared {
  ImuSample latest;
  uint32_t  samples = 0;
  uint32_t  i2cErrors = 0;
  uint32_t  impacts = 0;          // possible crashes since boot
  bool      impactPending = false;
  uint32_t  impactMs = 0;
  float     impactPeakG = 0;
};

// Main loop's crash check state.
struct CrashCheck {
  bool     active = false;        // watching GPS speed
  uint32_t impactMs = 0;
  float    peakG = 0;
  bool     sawSpeed = false;      // got a valid GPS speed in the window
  float    lastSpeedKmh = 0;
  uint32_t lastPollMs = 0;
  uint32_t confirmed = 0;
  uint32_t ignored = 0;
  float    lastPeakG = 0;
  bool     alerted = false;       // a crash was confirmed since boot
  uint32_t alertMs = 0;           // when, for CRASH_QUIET_MS
};

struct TelemetryRecord {
  uint64_t utcMs = 0;       // GPS fix time
  int32_t  latE7 = 0;       // degrees x 1e7
  int32_t  lonE7 = 0;
  uint16_t speedX10 = 0;    // km/h x 10
  uint8_t  crash = 0;
  uint16_t peakGx100 = 0;   // crash only: g x 100
};

// Flash FIFO of /kbuf/<seq>.jsonl files. The cursor (oldest file, byte
// offset, lines sent) is saved in /kbuf/cursor to survive power loss.
struct FlashBuffer {
  bool     ready = false;
  uint32_t firstSeq = 1;           // oldest file (being sent)
  uint32_t lastSeq = 1;            // newest file (appended to)
  uint32_t lastLines = 0;          // records in the newest file
  uint32_t readOffset = 0;         // byte offset of the next unsent line
  uint32_t readLines = 0;          // lines already sent from firstSeq
  uint32_t count = 0;              // unsent records
  uint32_t pendingCursorSaves = 0;
  bool     full = false;           // no room for another record
  bool     cacheValid = false;     // oldest line already read into cache
  uint32_t cacheLen = 0;           // its length including '\n'
  String   cache;
};

// up = the last send was delivered.
struct LinkState {
  bool     up = true;
  uint32_t failedAtMs = 0;
  int      lastStatus = 0;
};

struct OtaManifest {
  String   version;
  String   url;
  uint32_t size = 0;
  String   sha256;
};

// OTA download test: where the time goes between the check and the verified image.
struct OtaTiming {
  uint32_t bytes = 0;        // bytes downloaded and written
  uint32_t downloadMs = 0;   // all ranges fetched and written to flash
  uint32_t verifyMs = 0;     // SHA-256 check + Update.end()
};

/* ============================ FILE-SCOPE STATE ============================= */
HardwareSerial& SerialAT = Serial2;

GnssFix      g_fix;
GnssFix      g_lastGoodFix;
uint32_t     g_lastGoodFixMs = 0;
bool         g_gnssResponding = false;
volatile bool g_vehicleStill = false;  // valid fix under IMU_RECAL_MAX_KMH (set by gnssPoll, read by the IMU task)
int          g_signalQuality = -1;
bool         g_networkReady = false;
String       g_modemIp = "none";
CrashCheck   g_crash;
ImuShared    g_imu;
ImuOffsets   g_imuOffsets;   // loaded from NVS or calibrated before the IMU task starts
bool         g_imuCalibrated = false;          // g_imuOffsets holds a real calibration
volatile bool g_imuCalRequest = false;         // "calibrate" command: the IMU task runs it
portMUX_TYPE g_imuMux = portMUX_INITIALIZER_UNLOCKED;
bool         g_modemOk = false;                // the modem answers AT commands
uint32_t     g_modemLostMs = 0;                // when it stopped answering
bool         g_mpuOk = false;
uint32_t     g_lastReportMs = 0;
uint32_t     g_lastReportImuCnt = 0;
uint32_t     g_lastTelemetryMs = 0;
uint32_t     g_lastOtaMs = 0;
uint32_t     g_lastDataRetryMs = 0;
uint32_t     g_telemetrySent = 0;
uint32_t     g_telemetryFailed = 0;
uint64_t     g_lastRecordUtcMs = 0;  // newest fix time recorded
FlashBuffer  g_buffer;
LinkState    g_link;

char         g_deviceId[DEVICE_ID_MAX_LEN + 1]   = "";
char         g_authToken[AUTH_TOKEN_MAX_LEN + 1] = "";
bool         g_provisioned = false;

// New firmware after OTA is not auto-accepted: otaConfirmOrRollback() decides.
extern "C" bool verifyRollbackLater(void);
extern "C" bool verifyRollbackLater(void) { return true; }

bool timeElapsed(uint32_t now, uint32_t since, uint32_t period) {
  return (uint32_t)(now - since) >= period;   // wrap-safe
}

/* ====================== PER-TRACKER CREDENTIALS (NVS) ======================= */
// Both values go into a quoted AT command and a JSON string, so only
// letters, digits and the listed symbols are allowed.
bool credsCharsOk(const char* s, size_t minLen, size_t maxLen, const char* extra) {
  size_t n = strlen(s);
  if (n < minLen || n > maxLen) return false;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (!isalnum((unsigned char)c) && strchr(extra, c) == nullptr) return false;
  }
  return true;
}

bool credsValidId(const char* id) {
  return credsCharsOk(id, 1, DEVICE_ID_MAX_LEN, "-_.");
}

bool credsValidToken(const char* token) {
  return credsCharsOk(token, AUTH_TOKEN_MIN_LEN, AUTH_TOKEN_MAX_LEN, "-_.~+/=");
}

// Provisioned only if both values are present and valid.
bool credsLoad(void) {
  g_provisioned = false;
  g_deviceId[0] = '\0';
  g_authToken[0] = '\0';
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, true)) return false;   // namespace never written
  char id[DEVICE_ID_MAX_LEN + 1] = "";
  char token[AUTH_TOKEN_MAX_LEN + 1] = "";
  if (prefs.isKey(NVS_KEY_ID))    prefs.getString(NVS_KEY_ID, id, sizeof(id));
  if (prefs.isKey(NVS_KEY_TOKEN)) prefs.getString(NVS_KEY_TOKEN, token, sizeof(token));
  prefs.end();
  if (!credsValidId(id) || !credsValidToken(token)) return false;
  strlcpy(g_deviceId, id, sizeof(g_deviceId));
  strlcpy(g_authToken, token, sizeof(g_authToken));
  g_provisioned = true;
  return true;
}

// Writes both values and reads them back to confirm.
bool credsSave(const char* id, const char* token) {
  if (!credsValidId(id) || !credsValidToken(token)) return false;
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, false)) return false;
  bool ok = prefs.putString(NVS_KEY_ID, id) == strlen(id);
  ok = ok && prefs.putString(NVS_KEY_TOKEN, token) == strlen(token);
  prefs.end();
  return ok && credsLoad() && strcmp(g_deviceId, id) == 0 && strcmp(g_authToken, token) == 0;
}

// "2254...b4c3 (64 chars)"
String credsMaskedToken(void) {
  size_t n = strlen(g_authToken);
  if (n == 0) return String("none");
  return String(g_authToken).substring(0, 4) + "..." + String(g_authToken + n - 4) +
         " (" + String((unsigned)n) + " chars)";
}

void credsPrint(void) {
  if (g_provisioned) {
    Serial.printf("[NVS]   device_id %s  auth_token %s\r\n", g_deviceId, credsMaskedToken().c_str());
  } else {
    Serial.println("[NVS]   NOT PROVISIONED - nothing is recorded or sent until you run:");
    Serial.println("          provision <device_id> <auth_token>");
  }
}

/* ============================ SERIAL CONSOLE =============================== */
// "provision <device_id> <token>", read without blocking from loop().
const size_t CONSOLE_LINE_MAX = 200;

// New identity: send straight away instead of waiting out RETRY_MS.
void consoleResetLink(void) {
  g_link.up = true;
}

void consoleProvision(char* args) {
  char* id = strtok(args, " \t");
  char* token = strtok(nullptr, " \t");
  char* extra = strtok(nullptr, " \t");
  if (!id || !token || extra) {
    Serial.println("[CMD]   usage: provision <device_id> <auth_token>");
    return;
  }
  if (!credsValidId(id)) {
    Serial.printf("[CMD]   rejected: device_id must be 1-%u of A-Z a-z 0-9 - _ .\r\n",
                  (unsigned)DEVICE_ID_MAX_LEN);
    return;
  }
  if (!credsValidToken(token)) {
    Serial.printf("[CMD]   rejected: auth_token must be %u-%u of A-Z a-z 0-9 - _ . ~ + / =\r\n",
                  (unsigned)AUTH_TOKEN_MIN_LEN, (unsigned)AUTH_TOKEN_MAX_LEN);
    return;
  }
  if (!credsSave(id, token)) {
    Serial.println("[CMD]   NVS write FAILED");
    credsLoad();   // show whatever is stored now
    credsPrint();
    return;
  }
  consoleResetLink();
  Serial.printf("[CMD]   saved to NVS - sending as %s from now on\r\n", g_deviceId);
  credsPrint();
}

void consoleRun(char* line) {
  char* cmd = strtok(line, " \t");
  if (!cmd) return;
  if (strcasecmp(cmd, "provision") == 0) {
    char* rest = strtok(nullptr, "");   // rest of the line
    consoleProvision(rest ? rest : (char*)"");
  } else if (strcasecmp(cmd, "calibrate") == 0) {
    if (!g_mpuOk) { Serial.println("[CMD]   no MPU found: nothing to calibrate"); return; }
    g_imuCalRequest = true;   // run by the IMU task, which owns the I2C bus
    Serial.printf("[CMD]   calibrating MPU for %lu s - keep the board still\r\n",
                  (unsigned long)(MPU_CALIBRATION_MS / 1000));
  } else {
    Serial.println("[CMD]   unknown command - use: provision <device_id> <auth_token>  or  calibrate");
  }
}

void consoleService(void) {
  static char buf[CONSOLE_LINE_MAX + 1];
  static size_t len = 0;
  static bool overflow = false;
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') {
      if (overflow) {
        Serial.println("[CMD]   line too long - ignored");
      } else if (len > 0) {
        buf[len] = '\0';
        consoleRun(buf);
      }
      len = 0;
      overflow = false;
    } else if (len < CONSOLE_LINE_MAX) {
      buf[len++] = c;
    } else {
      overflow = true;
    }
  }
}

/* ================================== TIME ==================================== */
// All times are GPS UTC in ms since 1970; there is no ESP32 clock.

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

// Fraction digits ("0", "25", "125") -> ms.
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

// "ddmmyy" + "hhmmss.s" -> UTC ms, or 0 if malformed.
uint64_t gnssParseUtcMs(const String& date, const String& hms) {
  if (date.length() < 6 || hms.length() < 6) return 0;
  int day = twoDigits(date, 0), mon = twoDigits(date, 2), yr = twoDigits(date, 4);
  int hh  = twoDigits(hms, 0),  mm  = twoDigits(hms, 2),  ss = twoDigits(hms, 4);
  if (day < 1 || day > 31 || mon < 1 || mon > 12 || hh > 23 || mm > 59 || ss > 60) return 0;
  int ms = (hms.length() > 7 && hms[6] == '.') ? fractionToMs(hms.substring(7)) : 0;
  return (uint64_t)civilToMs(daysFromCivil(2000 + yr, mon, day), hh, mm, ss, ms);
}

// UTC ms -> "2026-09-19T13:00:00.123Z".
void formatUtcTime(uint64_t utcMs, char* out, size_t cap) {
  if (utcMs == 0) { snprintf(out, cap, "unknown"); return; }
  time_t secs = (time_t)(utcMs / 1000);
  struct tm parts;
  gmtime_r(&secs, &parts);
  char base[24];
  strftime(base, sizeof(base), "%Y-%m-%dT%H:%M:%S", &parts);
  snprintf(out, cap, "%s.%03uZ", base, (unsigned)(utcMs % 1000));
}

/* ============================= MODEM (RAW AT) ============================== */
void atFlushInput(void) {
  while (SerialAT.available()) { SerialAT.read(); }
}

// True once the response ends in OK or contains ERROR.
bool atFinalResult(const String& resp) {
  if (!resp.endsWith("\r\n")) return false;
  return resp.endsWith("OK\r\n") || resp.indexOf("ERROR") >= 0;
}

// Sends one command; returns everything up to the final result or timeout.
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

// Text after "<prefix>" on its line, e.g. "+CSQ:" -> "20,99".
bool atQuery(const String& cmd, const String& prefix, String& value, uint32_t timeoutMs = 3000) {
  String resp = atCommand(cmd, timeoutMs);
  int p = resp.indexOf(prefix);
  if (p < 0) return false;
  int e = resp.indexOf('\r', p);
  value = resp.substring(p + prefix.length(), (e >= 0) ? e : resp.length());
  value.trim();
  return true;
}

// Waits for a line starting with `prefix`, skipping other lines.
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

bool modemTestAT(void) {
  return atOk("AT", 500);
}

// One try to find the modem: at MODEM_BAUD, or at the factory speed and then
// moved to MODEM_BAUD with AT+IPR (saved with AT&W). Leaves Serial2 at MODEM_BAUD.
bool modemConnectOnce(void) {
  SerialAT.updateBaudRate(MODEM_BAUD);
  delay(50);
  if (modemTestAT()) return true;
  SerialAT.updateBaudRate(MODEM_FACTORY_BAUD);
  delay(50);
  if (modemTestAT()) {
    Serial.printf("          modem at %lu baud: setting it to %lu (AT+IPR)\r\n",
                  (unsigned long)MODEM_FACTORY_BAUD, (unsigned long)MODEM_BAUD);
    SerialAT.printf("AT+IPR=%lu\r", (unsigned long)MODEM_BAUD);
    SerialAT.flush();
    delay(200);
    SerialAT.updateBaudRate(MODEM_BAUD);
    delay(50);
    atFlushInput();
    if (modemTestAT()) {
      atOk("AT&W");   // save the setting so it survives a power-off
      Serial.printf("          modem now at %lu baud\r\n", (unsigned long)MODEM_BAUD);
      return true;
    }
    Serial.println("          modem did not answer at the new speed");
  }
  SerialAT.updateBaudRate(MODEM_BAUD);
  return false;
}

// Start-up: up to MODEM_READY_ATTEMPTS tries, 0.5 s apart.
bool modemConnect(void) {
  for (uint32_t i = 0; i < MODEM_READY_ATTEMPTS; i++) {
    if (modemConnectOnce()) return true;
    delay(500);
  }
  return false;
}

void modemInit(void) {
  atOk("ATE0");          // no echo
  atOk("AT+CMEE=2");     // readable error text
}

bool modemSimReady(void) {
  for (int i = 0; i < 5; i++) {
    String v;
    if (atQuery("AT+CPIN?", "+CPIN:", v) && v.startsWith("READY")) return true;
    delay(1000);
  }
  return false;
}

// "+CEREG: <n>,<stat>" -> stat (1 = home, 5 = roaming).
int modemRegStatus(const char* cmd, const char* prefix) {
  String v;
  if (!atQuery(cmd, prefix, v)) return -1;
  int comma = v.indexOf(',');
  return (comma >= 0) ? v.substring(comma + 1).toInt() : -1;
}

bool modemNetworkRegistered(void) {
  int eps = modemRegStatus("AT+CEREG?", "+CEREG:");   // LTE
  if (eps == 1 || eps == 5) return true;
  int ps = modemRegStatus("AT+CGREG?", "+CGREG:");    // 2G/3G
  return ps == 1 || ps == 5;
}

// "+CSQ: <rssi>,<ber>" -> rssi (0-31, 99 = unknown).
int modemSignalQuality(void) {
  String v;
  if (!atQuery("AT+CSQ", "+CSQ:", v)) return -1;
  return v.toInt();
}

// "+CGPADDR: 1,10.23.4.5" -> "10.23.4.5", or "none".
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

// Sets PDP context 1 to the APN and activates it.
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

// SSL context 0: any TLS 1.x, server certificate not verified, SNI on.
void modemConfigureTls(void) {
  atOk("AT+CSSLCFG=\"sslversion\",0,4");
  atOk("AT+CSSLCFG=\"authmode\",0,0");
  atOk("AT+CSSLCFG=\"enableSNI\",0,1");
}

/* ============================ MODEM HTTP(S) ================================ */
// Opens an HTTP session with the URL, the auth header, an optional extra
// header and SSL context 0. Headers are joined with a literal "\r\n"
// (backslash characters, not CR/LF). Close with httpEnd().
bool httpBeginWithHeader(const String& url, const String& extraHeader) {
  atCommand("AT+HTTPTERM", 1000);   // close any leftover session
  if (!atOk("AT+HTTPINIT", 5000)) return false;
  bool ok = atOk("AT+HTTPPARA=\"URL\",\"" + url + "\"");
  String headers = String("Authorization: Bearer ") + g_authToken;
  if (extraHeader.length() > 0) headers += "\\r\\n" + extraHeader;
  ok = ok && atOk("AT+HTTPPARA=\"USERDATA\",\"" + headers + "\"");
  if (url.startsWith("https://")) atOk("AT+HTTPPARA=\"SSLCFG\",0");
  return ok;
}

bool httpBegin(const String& url) {
  return httpBeginWithHeader(url, "");
}

void httpEnd(void) {
  atCommand("AT+HTTPTERM", 3000);
}

// AT+HTTPACTION=<method> -> HTTP status (6xx/7xx = modem error, < 0 = no reply).
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

// Reads `want` body bytes from `offset` (binary-safe).
bool httpReadChunk(uint32_t offset, uint8_t* buf, size_t want, size_t& got) {
  got = 0;
  atFlushInput();
  SerialAT.printf("AT+HTTPREAD=%lu,%u\r", (unsigned long)offset, (unsigned)want);
  String line;
  if (!waitForLine("+HTTPREAD:", HTTP_READ_WAIT_MS, line)) return false;
  size_t n = (size_t)line.substring(10).toInt();   // after "+HTTPREAD:"
  if (n == 0 || n > want) return false;
  uint32_t start = millis();
  while (got < n && millis() - start < HTTP_READ_WAIT_MS) {
    if (SerialAT.available()) buf[got++] = (uint8_t)SerialAT.read();
  }
  String tail;
  waitForLine("+HTTPREAD: 0", 3000, tail);   // end marker
  return got == n;
}

/* ================================== GNSS =================================== */
// +CGNSSINFO: fields are located relative to the N/S field, because modem
// firmware versions differ in how many satellite counts come before it.
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
  fix.valid = (fix.mode == 2 || fix.mode == 3) && inRange && nonZero;
  return fix.valid;
}

void gnssAccept(const GnssFix& fix) {
  g_fix = fix;
  g_lastGoodFix = fix;
  g_lastGoodFixMs = millis();
}

void gnssPoll(void) {
  if (!g_modemOk) return;   // modem lost: modemCheckAlive() already cleared the fix
  String resp = atCommand("AT+CGNSSINFO");
  g_gnssResponding = resp.indexOf("OK") >= 0;
  GnssFix fix;
  if (g_gnssResponding && gnssParseInfo(resp, fix)) {
    gnssAccept(fix);
  } else {
    g_fix.valid = false;
  }
  g_vehicleStill = g_fix.valid && g_fix.speedKmh < IMU_RECAL_MAX_KMH;
}

// Turns GNSS on. If it was off, waits up to GNSS_READY_WAIT_MS for the
// modem's "+CGNSSPWR: READY!" before the start-up checks go on. False if it
// didn't power on; detail is the text for the GNSS check line.
bool gnssPowerOn(String& detail) {
  if (atCommand("AT+CGNSSPWR?", 2000).indexOf("+CGNSSPWR: 1") >= 0) {
    detail = "already on (fix comes later)";
    return true;
  }
  uint32_t start = millis();
  String resp = atCommand("AT+CGNSSPWR=1", 3000);
  if (resp.indexOf("OK") < 0 && resp.indexOf("READY") < 0) {
    detail = "did not power on";
    return false;
  }
  bool ready = resp.indexOf("READY") >= 0;
  if (!ready) {
    Serial.printf("          waiting up to %lu s for GNSS READY...\r\n",
                  (unsigned long)(GNSS_READY_WAIT_MS / 1000));
    uint32_t used = millis() - start;
    String line;
    ready = used < GNSS_READY_WAIT_MS &&
            waitForLine("+CGNSSPWR: READY", GNSS_READY_WAIT_MS - used, line);
  }
  String secs = String((millis() - start) / 1000);
  detail = ready ? "on, READY after " + secs + " s (fix comes later)"
                 : "on, no READY within " + secs + " s (fix comes later)";
  return true;
}

// Turns GNSS on without waiting for READY. Used when the modem comes back
// while running: the regular GPS reads find the fix once there is one.
void gnssPowerOnNoWait(void) {
  if (atCommand("AT+CGNSSPWR?", 2000).indexOf("+CGNSSPWR: 1") < 0) atCommand("AT+CGNSSPWR=1", 3000);
}

// Run with every status report. A modem that stops answering is marked lost:
// GPS, network and link state are cleared, and the slow modem queries are
// skipped while it is. When it answers again its set-up is repeated, because
// a modem that restarted has forgotten it (echo, TLS options, GNSS power).
bool modemCheckAlive(void) {
  if (g_modemOk) {
    if (modemTestAT() || modemTestAT()) return true;   // one missed reply isn't a lost modem
    g_modemOk = false;
    g_modemLostMs = millis();
    g_fix.valid = false;
    g_gnssResponding = false;
    g_vehicleStill = false;
    g_signalQuality = -1;
    g_networkReady = false;
    g_modemIp = "none";
    g_link.up = false;                 // shown as backend DOWN, code -11
    g_link.failedAtMs = g_modemLostMs;
    g_link.lastStatus = -11;
    Serial.println("[MODEM] NOT ANSWERING: check its power and wiring. Records wait in flash.");
    return false;
  }
  if (!modemConnectOnce()) return false;   // still gone
  g_modemOk = true;
  modemInit();
  modemConfigureTls();
  gnssPowerOnNoWait();
  Serial.printf("[MODEM] answering again after %lu s: set up again\r\n",
                (unsigned long)((millis() - g_modemLostMs) / 1000));
  return true;
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

// 100 Hz, ~94 Hz low-pass, +/-1000 deg/s, +/-16 g. On the MPU-6500 family
// (WHO_AM_I 0x70/0x71/0x73) the accelerometer low-pass is set separately.
bool mpuConfigure(void) {
  bool ok = mpuWriteReg(MPU_REG_PWR_MGMT_1, 0x01);   // wake, gyro X clock
  delay(10);
  ok = ok && mpuWriteReg(MPU_REG_SMPLRT_DIV, 9);     // 1 kHz / (1 + 9)
  ok = ok && mpuWriteReg(MPU_REG_CONFIG, 0x02);      // ~94 Hz low-pass
  ok = ok && mpuWriteReg(MPU_REG_GYRO_CFG, 0x10);    // +/-1000 deg/s
  ok = ok && mpuWriteReg(MPU_REG_ACCEL_CFG, 0x18);   // +/-16 g
  uint8_t who = 0;
  if (ok && mpuReadRegs(MPU_REG_WHO_AM_I, &who, 1) && (who == 0x70 || who == 0x71 || who == 0x73)) {
    ok = mpuWriteReg(MPU_REG_ACCEL_CFG2, 0x02);      // accel ~99 Hz low-pass
  }
  return ok;
}

int16_t toInt16(uint8_t hi, uint8_t lo) {
  return (int16_t)(((uint16_t)hi << 8) | (uint16_t)lo);
}

// One reading with g_imuOffsets applied (scale 1, no bias during calibration).
bool mpuReadSample(ImuSample& s) {
  uint8_t b[MPU_DATA_BYTES];
  if (!mpuReadRegs(MPU_REG_DATA_START, b, sizeof(b))) return false;
  const float aScale = GRAVITY_MS2 / ACCEL_LSB_PER_G;
  const float gScale = DEG_TO_RADF / GYRO_LSB_PER_DPS;
  s.tMs   = millis();
  s.ax    = toInt16(b[0], b[1]) * aScale * g_imuOffsets.accelScale;
  s.ay    = toInt16(b[2], b[3]) * aScale * g_imuOffsets.accelScale;
  s.az    = toInt16(b[4], b[5]) * aScale * g_imuOffsets.accelScale;
  s.tempC = (toInt16(b[6], b[7]) / 340.0f) + 36.53f;
  s.gx    = toInt16(b[8], b[9]) * gScale - g_imuOffsets.gx;
  s.gy    = toInt16(b[10], b[11]) * gScale - g_imuOffsets.gy;
  s.gz    = toInt16(b[12], b[13]) * gScale - g_imuOffsets.gz;
  s.accelMag = sqrtf(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
  s.gyroMag  = sqrtf(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz);
  s.impactG  = fabsf(s.accelMag / GRAVITY_MS2 - 1.0f);
  return true;
}

// Averages MPU_CALIBRATION_MS of readings at rest. Gyro bias = its average.
// Accelerometer: one scale factor = 1 g / the average strength, so a still
// board reads exactly 1 g whichever way it is mounted or tilted.
// Starts after IMU_SETTLE_SAMPLES worth of time so the first readings are skipped.
// False (off unchanged) if no reading succeeded. restG = strength at rest, in g.
bool mpuCalibrate(ImuOffsets& off, float& restG) {
  delay(IMU_SETTLE_SAMPLES * IMU_PERIOD_MS);
  double sumAx = 0, sumAy = 0, sumAz = 0, sumGx = 0, sumGy = 0, sumGz = 0;
  int n = 0;
  uint32_t start = millis();
  while (millis() - start < MPU_CALIBRATION_MS) {
    ImuSample s;
    if (mpuReadSample(s)) {
      sumAx += s.ax; sumAy += s.ay; sumAz += s.az;
      sumGx += s.gx; sumGy += s.gy; sumGz += s.gz;
      n++;
    }
    delay(4);
  }
  if (n == 0) return false;
  float avgAx = sumAx / n, avgAy = sumAy / n, avgAz = sumAz / n;
  restG = sqrtf(avgAx * avgAx + avgAy * avgAy + avgAz * avgAz) / GRAVITY_MS2;
  off.gx = sumGx / n;
  off.gy = sumGy / n;
  off.gz = sumGz / n;

  // One scale factor, not per-axis offsets: per-axis offsets assume the board
  // is level, so on a tilted board they store part of gravity as "sensor
  // error", and the strength then drifts away from 1 g when the angle changes.
  // A scale factor keeps the strength at 1 g at any angle. Crash detection
  // only uses the strength, so nothing else is needed.
  // No gravity measured at all means the readings can't be trusted.
  if (restG <= 0.0f) {
    return false;
  }
  off.accelScale = 1.0f / restG;
  return true;
}

// Saved calibration in NVS. Load is false if none is stored.
bool imuCalLoad(ImuOffsets& off) {
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, true)) return false;
  ImuOffsets tmp;
  bool ok = prefs.isKey(NVS_KEY_IMU_CAL) &&
            prefs.getBytes(NVS_KEY_IMU_CAL, &tmp, sizeof(tmp)) == sizeof(tmp);
  prefs.end();
  if (ok) off = tmp;
  return ok;
}

bool imuCalSave(const ImuOffsets& off) {
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, false)) return false;
  bool ok = prefs.putBytes(NVS_KEY_IMU_CAL, &off, sizeof(off)) == sizeof(off);
  prefs.end();
  return ok;
}

// Calibrates into g_imuOffsets (readings are raw while it runs). A good
// calibration (board still: rest strength CAL_MIN/MAX_REST_G, gyro bias under
// CAL_MAX_GYRO_BIAS) is used, and saved if `save`. A bad one is used only when
// there is no calibration yet; otherwise the current one stays. note = log text.
void imuCalibrate(bool save, String& note) {
  ImuOffsets old = g_imuOffsets;
  ImuOffsets fresh;
  float restG = 0;
  g_imuOffsets = ImuOffsets();
  if (!mpuCalibrate(fresh, restG)) {
    g_imuOffsets = old;
    note = "calibration got no readings, previous one kept";
    return;
  }
  float gyroBias = sqrtf(fresh.gx * fresh.gx + fresh.gy * fresh.gy + fresh.gz * fresh.gz);
  String values = "rest " + String(restG, 2) + " g, gyro bias " + String(gyroBias, 3) + " rad/s";
  bool good = restG >= CAL_MIN_REST_G && restG <= CAL_MAX_REST_G && gyroBias <= CAL_MAX_GYRO_BIAS;
  if (!good && g_imuCalibrated) {
    g_imuOffsets = old;
    note = "board moved during calibration (" + values + "): previous calibration kept";
    return;
  }
  g_imuOffsets = fresh;
  g_imuCalibrated = true;
  if (!good)      note = "board moved during calibration (" + values + "): used, NOT saved";
  else if (!save) note = "new calibration (" + values + ")";
  else            note = imuCalSave(fresh) ? "new calibration saved (" + values + ")"
                                           : "new calibration (" + values + "), NVS save FAILED";
}

/* ============================== IMU TASK (core 0) ========================== */
// Counts samples in a row above CRASH_IMPACT_G and keeps the run's peak.
void imuTrackImpact(ImuFilter& f, const ImuSample& s) {
  if (s.impactG <= CRASH_IMPACT_G) {
    f.overCount = 0;
    f.runPeakG = 0;
    return;
  }
  f.overCount++;
  if (s.impactG > f.runPeakG) f.runPeakG = s.impactG;
}

// A run of CRASH_MIN_SAMPLES becomes a pending possible crash for the main
// loop; while it waits, further impacts only raise its peak.
void imuPublish(const ImuSample& s, bool readOk, const ImuFilter& f) {
  bool impact = readOk && f.overCount >= CRASH_MIN_SAMPLES;
  portENTER_CRITICAL(&g_imuMux);
  if (readOk) {
    g_imu.latest = s;
    g_imu.samples++;
  } else {
    g_imu.i2cErrors++;
  }
  if (impact) {
    if (f.overCount == CRASH_MIN_SAMPLES) g_imu.impacts++;   // run just qualified
    if (!g_imu.impactPending) {
      g_imu.impactPending = true;
      g_imu.impactMs = s.tMs;
      g_imu.impactPeakG = f.runPeakG;
    } else if (f.runPeakG > g_imu.impactPeakG) {
      g_imu.impactPeakG = f.runPeakG;
    }
  }
  portEXIT_CRITICAL(&g_imuMux);
}

// After IMU_REINIT_ERRORS failed reads: re-configure the MPU, and calibrate
// it again (MPU_CALIBRATION_MS, no impacts detected meanwhile) only if GPS
// shows the vehicle still; moving or no fix keeps the old offsets. Offsets are
// cleared during calibration so it averages raw readings; if it gets no
// readings, the old offsets stay.
void imuRecover(void) {
  if (!mpuConfigure()) return;   // still not answering: tried again on the next error
  if (!g_vehicleStill) {
    Serial.println("[IMU]   read failed: MPU re-configured (moving or no GPS fix: offsets kept)");
    return;
  }
  Serial.printf("[IMU]   read failed: MPU re-configured, recalibrating for %lu s (vehicle still)\r\n",
                (unsigned long)(MPU_CALIBRATION_MS / 1000));
  String note;
  imuCalibrate(false, note);   // not saved: the saved one comes from a still bench
  Serial.printf("[IMU]   %s\r\n", note.c_str());
}

void imuStep(ImuFilter& f) {
  if (g_imuCalRequest) {            // "calibrate" command
    g_imuCalRequest = false;
    String note;
    imuCalibrate(true, note);
    Serial.printf("[IMU]   %s\r\n", note.c_str());
    f.settle = IMU_SETTLE_SAMPLES;
    f.overCount = 0;
    f.runPeakG = 0;
  }
  ImuSample s;
  if (!mpuReadSample(s)) {
    f.consecutiveErrors++;
    if (f.consecutiveErrors >= IMU_REINIT_ERRORS) {
      imuRecover();
      f.consecutiveErrors = 0;
      f.settle = IMU_SETTLE_SAMPLES;
    }
    f.overCount = 0;                // a gap ends the run
    f.runPeakG = 0;
    imuPublish(s, false, f);
    return;
  }
  f.consecutiveErrors = 0;
  if (f.settle > 0) {
    f.settle--;
  } else {
    imuTrackImpact(f, s);
  }
  imuPublish(s, true, f);
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

// Takes and clears a pending possible crash.
bool imuTakeImpact(uint32_t& impactMs, float& peakG) {
  bool taken = false;
  portENTER_CRITICAL(&g_imuMux);
  if (g_imu.impactPending) {
    impactMs = g_imu.impactMs;
    peakG = g_imu.impactPeakG;
    g_imu.impactPending = false;
    taken = true;
  }
  portEXIT_CRITICAL(&g_imuMux);
  return taken;
}

bool imuStart(void) {
  return xTaskCreatePinnedToCore(imuTask, "imu", 6144, NULL, 3, NULL, 0) == pdPASS;   // room for NVS + log text
}

/* ============================ START-UP CHECKS =============================== */
// MPU, modem and SIM are critical: a failure after an OTA update rolls the
// firmware back.
bool g_criticalOk = true;

void checkPrint(const char* label, bool pass, bool critical, const String& detail) {
  Serial.printf("  [%-6s] %-4s  %s\r\n", label, pass ? "PASS" : (critical ? "FAIL" : "WARN"), detail.c_str());
  if (!pass && critical) g_criticalOk = false;
}

bool runStartupChecks(void) {
  g_criticalOk = true;

  bufferMount();
  checkPrint("FLASH", g_buffer.ready, false,
             g_buffer.ready ? String(g_buffer.count) + " unsent record(s)" : String("LittleFS mount failed"));

  uint8_t who = 0;
  g_mpuOk = mpuReadRegs(MPU_REG_WHO_AM_I, &who, 1) && mpuConfigure();
  String calNote = "not calibrated";
  if (g_mpuOk) {   // before the IMU task starts
    if (imuCalLoad(g_imuOffsets)) {
      g_imuCalibrated = true;
      calNote = "saved calibration";
    } else {
      Serial.printf("          no saved calibration: calibrating MPU for %lu s (keep the vehicle still)...\r\n",
                    (unsigned long)(MPU_CALIBRATION_MS / 1000));
      imuCalibrate(true, calNote);
    }
  }
  bool imuRunning = imuStart();   // started even without an MPU: imuStep() keeps retrying
  String mpuDetail = "WHO_AM_I 0x" + String(who, HEX) + ", " + calNote + ", accel scale " + String(g_imuOffsets.accelScale, 3) + ", gyro bias " +
                     String(g_imuOffsets.gx, 3) + "/" + String(g_imuOffsets.gy, 3) + "/" +
                     String(g_imuOffsets.gz, 3) + " rad/s, 100 Hz task running";
  if (!g_mpuOk) mpuDetail = "not found at 0x68 (check SDA=21, SCL=22, power)";
  else if (!imuRunning) mpuDetail = "IMU task failed to start";
  checkPrint("MPU", g_mpuOk && imuRunning, true, mpuDetail);

  g_modemOk = modemConnect();   // also moves a factory-speed modem to MODEM_BAUD
  if (g_modemOk) modemInit();
  checkPrint("MODEM", g_modemOk, true,
             g_modemOk ? "responding at " + String(MODEM_BAUD) + " baud"
                       : String("no reply (check TX->D16, RX->D17, power, modem baud rate)"));

  bool simOk = g_modemOk && modemSimReady();
  checkPrint("SIM", simOk, true, simOk ? "ready" : "not ready (inserted? PIN locked?)");

  g_networkReady = simOk && modemNetworkRegistered();
  g_signalQuality = g_modemOk ? modemSignalQuality() : -1;
  checkPrint("NET", g_networkReady, false,
             String(g_networkReady ? "registered" : "not registered yet") + ", signal " + String(g_signalQuality));

  bool dataOk = g_networkReady && modemDataConnect(APN);
  checkPrint("DATA", dataOk, false, dataOk ? "IP " + g_modemIp : String("no IP yet (loop() retries)"));

  String gnssDetail = "did not power on";
  bool gnssOk = g_modemOk && gnssPowerOn(gnssDetail);
  checkPrint("GNSS", gnssOk, false, gnssDetail);

  Serial.println(g_criticalOk ? "  READY\r\n" : "  CRITICAL FAILURE (running in degraded mode)\r\n");
  return g_criticalOk;
}

/* ============================ RECORDS (JSON) ================================ */
// Stored line: {"latitude","longitude","speed","crash",["peak_g",]"recorded_at"}.
// device_id is added in front when it is sent.
bool recordToJson(const TelemetryRecord& r, String& out) {
  StaticJsonDocument<256> doc;
  doc["latitude"]  = r.latE7 / 1.0e7;
  doc["longitude"] = r.lonE7 / 1.0e7;
  doc["speed"]     = r.speedX10 / 10.0;
  doc["crash"]     = (bool)r.crash;
  if (r.crash) doc["peak_g"] = r.peakGx100 / 100.0;
  char ts[32];
  formatUtcTime(r.utcMs, ts, sizeof(ts));
  doc["recorded_at"] = ts;
  out = "";
  serializeJson(doc, out);
  return true;
}

// Routine record: needs a current fix. Crash record: falls back to the last good fix.
bool telemetryMakeRecord(bool crash, float peakG, TelemetryRecord& out) {
  out = TelemetryRecord();
  if (!g_fix.valid && !crash) return false;
  const GnssFix& fix = g_fix.valid ? g_fix : g_lastGoodFix;
  if (!fix.valid || fix.utcMs == 0) return false;   // no fix since boot
  float speed = (fix.speedKmh < 0.0f) ? 0.0f : fix.speedKmh;
  out.utcMs    = fix.utcMs;
  out.latE7    = (int32_t)lround(fix.latDeg * 1.0e7);
  out.lonE7    = (int32_t)lround(fix.lonDeg * 1.0e7);
  out.speedX10 = (speed > 6553.0f) ? 65530 : (uint16_t)lroundf(speed * 10.0f);
  out.crash    = crash ? 1 : 0;
  if (crash && peakG > 0.0f) {
    out.peakGx100 = (peakG >= 655.0f) ? 65500 : (uint16_t)lroundf(peakG * 100.0f);
  }
  return true;
}

// Writes a record to the flash buffer. A routine record is skipped if the
// fix is no newer than the last one recorded; a crash record never is.
void telemetryEnqueue(bool crash, float peakG) {
  if (!g_provisioned) return;
  TelemetryRecord r;
  if (!telemetryMakeRecord(crash, peakG, r)) {
    if (crash) Serial.println("[CRASH] not recorded: no GPS fix since boot");
    return;
  }
  if (!crash && r.utcMs <= g_lastRecordUtcMs) return;
  if (r.utcMs > g_lastRecordUtcMs) g_lastRecordUtcMs = r.utcMs;
  String line;
  recordToJson(r, line);
  bufferPush(line);
}

/* ============================== HTTPS SEND =================================== */
// POSTs json to url. Returns the HTTP status, a modem error (6xx/7xx) or < 0.
int httpPostJson(const char* url, const String& json) {
  if (!httpBegin(url)) { httpEnd(); return -1; }
  atOk("AT+HTTPPARA=\"CONTENT\",\"application/json\"");

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

/* ================= FLASH BUFFER (STORE-AND-FORWARD, JSON-LINES) ============= */
String bufferPath(uint32_t seq) {
  char buf[32];
  snprintf(buf, sizeof(buf), "%s/%08lu.jsonl", BUFFER_DIR, (unsigned long)seq);
  return String(buf);
}

void bufferDeleteSegment(uint32_t seq) {
  String path = bufferPath(seq);
  if (LittleFS.exists(path)) LittleFS.remove(path);
}

void bufferSaveCursor(void) {
  File f = LittleFS.open(String(BUFFER_DIR) + "/cursor", "w");
  if (f) {
    f.printf("%lu,%lu,%lu\n", (unsigned long)g_buffer.firstSeq,
             (unsigned long)g_buffer.readOffset, (unsigned long)g_buffer.readLines);
    f.close();
  }
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

// Deletes the oldest file once all its lines are sent and a newer one exists.
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

// True when the newest file is full and no new file is allowed.
bool bufferNoRoom(void) {
  return g_buffer.lastLines >= RECORDS_PER_FILE &&
         g_buffer.lastSeq - g_buffer.firstSeq + 1 >= BUFFER_MAX_FILES;
}

// Appends one record. When there is no room it is refused; unsent records
// are never overwritten.
void bufferPush(const String& line) {
  if (!g_buffer.ready) return;
  if (bufferNoRoom()) {
    if (!g_buffer.full) Serial.println("[BUF]   buffer FULL: new records refused until it drains");
    g_buffer.full = true;
    return;
  }
  if (g_buffer.lastLines >= RECORDS_PER_FILE) {   // start a new file
    g_buffer.lastSeq++;
    g_buffer.lastLines = 0;
    bufferReleaseConsumed();
  }
  File f = LittleFS.open(bufferPath(g_buffer.lastSeq), "a");
  bool ok = f && f.print(line + "\n");
  if (f) f.close();
  if (!ok) return;
  g_buffer.full = false;
  g_buffer.lastLines++;
  g_buffer.count++;
}

// Reads the line at `offset` of file `seq` (without '\n'). Returns the bytes
// used, or 0 at the end of the file.
uint32_t bufferReadLine(uint32_t seq, uint32_t offset, String& line) {
  line = "";
  String path = bufferPath(seq);
  if (!LittleFS.exists(path)) return 0;
  File f = LittleFS.open(path, "r");
  if (!f) return 0;
  uint32_t used = 0;
  if (offset < f.size() && f.seek(offset)) {
    line = f.readStringUntil('\n');
    used = f.position() - offset;
  }
  f.close();
  return used;
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

// Loads the oldest unsent line into the cache. A line that isn't a whole
// JSON object (power cut mid-write) is dropped.
bool bufferLoadOldest(void) {
  String line;
  uint32_t used = bufferReadLine(g_buffer.firstSeq, g_buffer.readOffset, line);
  if (used == 0) {   // end of this file
    if (g_buffer.firstSeq < g_buffer.lastSeq) {
      g_buffer.readLines = RECORDS_PER_FILE;
      bufferReleaseConsumed();
    } else {
      g_buffer.count = 0;
    }
    return false;
  }
  line.trim();
  if (!line.startsWith("{") || !line.endsWith("}")) {
    bufferAdvance(used);
    return false;
  }
  g_buffer.cache = line;
  g_buffer.cacheLen = used;
  g_buffer.cacheValid = true;
  return true;
}

bool bufferPeekOldest(String& out) {
  if (!g_buffer.ready || g_buffer.count == 0) return false;
  bool found = g_buffer.cacheValid;
  for (int attempt = 0; attempt < 4 && !found && g_buffer.count > 0; attempt++) {
    found = bufferLoadOldest();
  }
  if (found) out = g_buffer.cache;
  return found;
}

void bufferPopOldest(void) {
  if (!g_buffer.cacheValid || g_buffer.count == 0) return;
  bufferAdvance(g_buffer.cacheLen);
}

// Oldest and newest file numbers; false if there are none.
bool bufferScanSegments(uint32_t& minSeq, uint32_t& maxSeq) {
  minSeq = 0xFFFFFFFF;
  maxSeq = 0;
  File dir = LittleFS.open(BUFFER_DIR);
  if (!dir || !dir.isDirectory()) return false;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String name = f.name();
    int slash = name.lastIndexOf('/');
    String base = (slash >= 0) ? name.substring(slash + 1) : name;
    uint32_t seq = base.endsWith(".jsonl") ? (uint32_t)base.toInt() : 0;
    if (seq > 0) {
      minSeq = min(minSeq, seq);
      maxSeq = max(maxSeq, seq);
    }
    f.close();
  }
  dir.close();
  return maxSeq > 0;
}

uint32_t fileCountLines(const String& path) {
  if (!LittleFS.exists(path)) return 0;
  File f = LittleFS.open(path, "r");
  if (!f) return 0;
  uint32_t lines = 0;
  while (f.available()) {
    f.readStringUntil('\n');
    lines++;
  }
  f.close();
  return lines;
}

// Mounts LittleFS (formats it if it can't mount) and resumes from the saved
// cursor: files before it are deleted, and the count assumes every file
// except the newest holds RECORDS_PER_FILE lines.
void bufferMount(void) {
  g_buffer = FlashBuffer();
  if (!LittleFS.begin(true)) return;
  if (!LittleFS.exists(BUFFER_DIR)) LittleFS.mkdir(BUFFER_DIR);
  uint32_t minSeq = 1, maxSeq = 1;
  if (bufferScanSegments(minSeq, maxSeq)) {
    g_buffer.firstSeq = minSeq;
    g_buffer.lastSeq = maxSeq;
  }
  uint32_t seq = 0, offset = 0, lines = 0;
  if (bufferLoadCursor(seq, offset, lines) && seq >= g_buffer.firstSeq && seq <= g_buffer.lastSeq) {
    for (uint32_t s = g_buffer.firstSeq; s < seq; s++) bufferDeleteSegment(s);
    g_buffer.firstSeq = seq;
    g_buffer.readOffset = offset;
    g_buffer.readLines = lines;
  }
  g_buffer.lastLines = fileCountLines(bufferPath(g_buffer.lastSeq));
  uint32_t total = (g_buffer.lastSeq - g_buffer.firstSeq) * RECORDS_PER_FILE + g_buffer.lastLines;
  g_buffer.count = (total > g_buffer.readLines) ? (total - g_buffer.readLines) : 0;
  g_buffer.full = bufferNoRoom();
  g_buffer.ready = true;
  bufferSaveCursor();
}

/* ============================ BACKEND LINK ================================= */
bool statusDelivered(int status) { return status >= 200 && status < 300; }

bool linkNetworkReady(void) { return g_networkReady && g_modemIp != "none"; }

uint32_t telemetryRecordPeriod(void) {
  return (g_link.up && linkNetworkReady()) ? TELEMETRY_PERIOD_MS : OFFLINE_RECORD_PERIOD_MS;
}

void linkMarkSuccess(int status) {
  if (!g_link.up) {
    Serial.printf("[LINK]  backend reachable again: %lu buffered record(s) to send\r\n",
                  (unsigned long)g_buffer.count);
  }
  g_link.up = true;
  g_link.lastStatus = status;
}

void linkMarkFailure(int status) {
  g_link.up = false;
  g_link.failedAtMs = millis();
  g_link.lastStatus = status;
  Serial.printf("[LINK]  send failed (code %d): records kept in flash, next try in %lu s\r\n",
                status, (unsigned long)(RETRY_MS / 1000));
}

int telemetrySendLine(const String& line) {
  String body = String("{\"device_id\":\"") + g_deviceId + "\"," + line.substring(1);
  return httpPostJson(TELEMETRY_URL, body);
}

// Sends buffered records oldest-first, up to DRAIN_MAX_PER_PASS within
// DRAIN_BUDGET_MS. A record is removed only after HTTP 2xx; HTTP 400 drops
// it. Any other result keeps it and pauses sending for RETRY_MS; no mobile
// data counts as failure -10.
void telemetryService(uint32_t now) {
  if (!g_provisioned || g_buffer.count == 0) return;
  if (!g_link.up && !timeElapsed(now, g_link.failedAtMs, RETRY_MS)) return;
  if (!linkNetworkReady()) {
    linkMarkFailure(-10);
    return;
  }
  uint32_t start = millis();
  for (uint32_t i = 0; i < DRAIN_MAX_PER_PASS && (millis() - start) < DRAIN_BUDGET_MS; i++) {
    String line;
    if (!bufferPeekOldest(line)) return;
    int status = telemetrySendLine(line);
    if (statusDelivered(status)) {
      bufferPopOldest();
      g_telemetrySent++;
      linkMarkSuccess(status);
    } else if (status == 400) {
      bufferPopOldest();
      g_telemetryFailed++;
      Serial.println("[TX]    record rejected by the backend (HTTP 400): dropped");
    } else {
      g_telemetryFailed++;
      linkMarkFailure(status);
      return;
    }
  }
}

/* ============================== FULL-BUFFER SLEEP ========================== */
// Buffer full and backend not answering: deep sleep FULL_SLEEP_MS. Waking
// restarts the firmware; the first send then decides: delivered = stay awake
// and drain, failed = sleep again. Crash detection is off while asleep.
void sleepWhileFullAndOffline(void) {
  if (!g_buffer.full || g_link.up || g_crash.active) return;
  Serial.printf("[SLEEP] buffer full and backend not answering: sleeping %lu min\r\n",
                (unsigned long)(FULL_SLEEP_MS / 60000));
  bufferSaveCursor();
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)FULL_SLEEP_MS * 1000ULL);
  esp_deep_sleep_start();
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
  Serial.printf("[OTA] manifest HTTP %d, %u bytes\r\n", status, body.length());
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

// True if version a is newer than b ("1.2.0" > "1.1.9").
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

// Fetches bytes [start, start+len) into dst with one HTTP Range request.
// Nothing is written to flash here, so a failed range can be retried.
bool otaFetchRange(const String& url, uint32_t start, uint32_t len, uint8_t* dst) {
  String range = "Range: bytes=" + String(start) + "-" + String(start + len - 1);
  if (!httpBeginWithHeader(url, range)) { httpEnd(); return false; }
  uint32_t bodyLen = 0;
  int status = httpAction(0, HTTP_GET_WAIT_MS, bodyLen);   // 0 = GET
  // 206 = partial content. 200 is accepted only for an image that fits in one range.
  bool rangeOk = (status == 206) || (status == 200 && start == 0);
  if (!rangeOk || bodyLen != len) {
    Serial.printf("[OTA] range %lu-%lu refused: HTTP %d, %lu bytes\r\n",
                  (unsigned long)start, (unsigned long)(start + len - 1), status, (unsigned long)bodyLen);
    httpEnd();
    return false;
  }
  uint32_t got = 0;
  bool ok = true;
  while (ok && got < len) {
    size_t want = min((uint32_t)OTA_CHUNK_SIZE, len - got);
    size_t n = 0;
    ok = httpReadChunk(got, dst + got, want, n);
    if (ok) got += n;
  }
  httpEnd();
  return ok && got == len;
}

// Downloads the image range by range into the spare OTA slot, checks its
// SHA-256, and activates it for the next boot. Fills t with the timings.
bool otaInstall(const OtaManifest& m, OtaTiming& t) {
  if (m.size == 0) return false;
  if (!Update.begin((size_t)m.size, U_FLASH)) {
    Serial.printf("[OTA] image of %lu bytes does not fit the OTA slot\r\n", (unsigned long)m.size);
    return false;
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);   // 0 = SHA-256

  static uint8_t rangeBuf[OTA_RANGE_BYTES];   // static: too big for the stack
  uint32_t total = 0;
  bool ok = true;
  uint32_t downloadStart = millis();
  while (ok && total < m.size) {
    uint32_t len = min((uint32_t)OTA_RANGE_BYTES, m.size - total);
    uint32_t rangeStart = millis();
    bool fetched = false;
    for (uint32_t attempt = 1; attempt <= OTA_RANGE_RETRIES && !fetched; attempt++) {
      fetched = otaFetchRange(m.url, total, len, rangeBuf);
      if (!fetched) Serial.printf("[OTA] range at %lu failed (attempt %lu/%lu)\r\n",
                                  (unsigned long)total, (unsigned long)attempt,
                                  (unsigned long)OTA_RANGE_RETRIES);
    }
    ok = fetched && Update.write(rangeBuf, len) == len;
    if (ok) {
      mbedtls_sha256_update(&sha, rangeBuf, len);
      total += len;
      Serial.printf("[OTA] %lu / %lu bytes  (range %lu ms)\r\n", (unsigned long)total,
                    (unsigned long)m.size, (unsigned long)(millis() - rangeStart));
    }
  }
  t.bytes = total;
  t.downloadMs = millis() - downloadStart;

  uint32_t verifyStart = millis();
  uint8_t digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);
  if (!ok) Serial.printf("[OTA] download stopped at %lu / %lu bytes\r\n", (unsigned long)total, (unsigned long)m.size);
  ok = ok && total == m.size && otaDigestMatches(digest, m.sha256);
  if (!ok) Update.abort();   // old firmware stays
  else ok = Update.end(true);   // boot the new slot next
  t.verifyMs = millis() - verifyStart;
  return ok;
}

// One line with the download test result: check start -> verified image.
void otaPrintTiming(bool ok, uint32_t manifestMs, const OtaTiming& t, uint32_t totalMs) {
  float kbPerS = (t.downloadMs > 0) ? (t.bytes / 1024.0f) / (t.downloadMs / 1000.0f) : 0.0f;
  Serial.printf("[OTA] timing (%s): manifest %lu ms, download %lu ms for %lu bytes (%.1f KB/s), "
                "verify %lu ms, total %lu ms\r\n",
                ok ? "verified" : "FAILED", (unsigned long)manifestMs, (unsigned long)t.downloadMs,
                (unsigned long)t.bytes, kbPerS, (unsigned long)t.verifyMs, (unsigned long)totalMs);
}

// Parked (valid fix under 3 km/h), signal 10+, no crash check running.
bool otaSafeToUpdate(void) {
  bool parked = g_fix.valid && g_fix.speedKmh < 3.0f;
  bool network = g_networkReady && g_signalQuality >= 10;
  return parked && network && !g_crash.active;
}

void otaCheck(void) {
  if (!g_provisioned) return;
  uint32_t checkStart = millis();
  OtaManifest m;
  if (!otaFetchManifest(m)) { Serial.println("[OTA] could not read manifest"); return; }
  uint32_t manifestMs = millis() - checkStart;
  Serial.printf("[OTA] running %s, server has %s\r\n", FW_VERSION, m.version.c_str());
  if (!otaIsNewer(m.version, FW_VERSION)) { Serial.println("[OTA] up to date"); return; }
  if (!otaSafeToUpdate()) { Serial.println("[OTA] postponed: vehicle not parked or weak network"); return; }
  OtaTiming t;
  bool installed = otaInstall(m, t);
  otaPrintTiming(installed, manifestMs, t, millis() - checkStart);
  if (installed) {
    Serial.printf("[OTA] verified, rebooting into %s\r\n", m.version.c_str());
    delay(500);
    ESP.restart();
  }
}

// New firmware boots on trial: kept if the critical checks passed,
// otherwise the bootloader returns to the previous one.
void otaConfirmOrRollback(bool checksOk) {
  const esp_partition_t* running = esp_ota_get_running_partition();
  if (!running) return;
  esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
  bool known = esp_ota_get_state_partition(running, &state) == ESP_OK;
  Serial.printf("[BOOT] firmware %s running from slot '%s'\r\n", FW_VERSION, running->label);
  bool trial = known && state == ESP_OTA_IMG_PENDING_VERIFY;
  if (trial && !checksOk) {
    Serial.println("[BOOT] new firmware failed its checks: ROLLING BACK");
    delay(500);
    esp_ota_mark_app_invalid_rollback_and_reboot();
  }
  esp_ota_mark_app_valid_cancel_rollback();
  if (trial) Serial.println("[BOOT] new firmware passed its checks: update ACCEPTED");
}

/* ============================== STATUS REPORT ============================== */
void reportGnss(void) {
  Serial.println("[GPS]   ---- GNSS (AT+CGNSSINFO) ----");
  if (g_fix.valid) {
    char ts[32];
    formatUtcTime(g_fix.utcMs, ts, sizeof(ts));
    Serial.printf("        Fix type    : %dD fix\r\n", g_fix.mode);
    Serial.printf("        Satellites  : %d\r\n", g_fix.satellites);
    Serial.printf("        Latitude    : %.6f deg\r\n", g_fix.latDeg);
    Serial.printf("        Longitude   : %.6f deg\r\n", g_fix.lonDeg);
    Serial.printf("        Altitude    : %.1f m\r\n", g_fix.altM);
    Serial.printf("        Speed       : %.1f km/h\r\n", g_fix.speedKmh);
    Serial.printf("        Course      : %.1f deg\r\n", g_fix.courseDeg);
    Serial.printf("        HDOP        : %.1f\r\n", g_fix.hdop);
    Serial.printf("        Fix time    : %s (UTC)\r\n", ts);
  } else if (g_lastGoodFix.valid) {
    Serial.println("        Fix type    : NONE (no current fix)");
    Serial.printf("        Last fix    : %.6f, %.6f deg (%lu s ago)\r\n",
                  g_lastGoodFix.latDeg, g_lastGoodFix.lonDeg,
                  (unsigned long)((millis() - g_lastGoodFixMs) / 1000));
  } else {
    Serial.printf("        Fix type    : NONE (GNSS %s)\r\n",
                  g_gnssResponding ? "answering, no fix yet" : "NOT answering");
  }
}

void reportImu(const ImuShared& imu, uint32_t now) {
  uint32_t dtMs = now - g_lastReportMs;
  uint32_t dn = imu.samples - g_lastReportImuCnt;
  float rate = (dtMs > 0) ? (dn * 1000.0f / dtMs) : 0.0f;
  const ImuSample& s = imu.latest;
  Serial.printf("[IMU]   rate %.1f Hz  |a| %.2f m/s^2  impact %.2f g  |g| %.2f rad/s\r\n",
                rate, s.accelMag, s.impactG, s.gyroMag);
  Serial.printf("        a(x,y,z) %.2f %.2f %.2f  g(x,y,z) %.2f %.2f %.2f  temp %.1f C  I2C errors %lu\r\n",
                s.ax, s.ay, s.az, s.gx, s.gy, s.gz, s.tempC, (unsigned long)imu.i2cErrors);
  g_lastReportImuCnt = imu.samples;
}

void reportNetwork(void) {
  Serial.println("[NET]   ---- modem / network ----");
  if (g_modemOk) {
    Serial.println("        Modem       : answering");
  } else {
    Serial.printf("        Modem       : NOT ANSWERING for %lu s\r\n",
                  (unsigned long)((millis() - g_modemLostMs) / 1000));
  }
  Serial.printf("        Signal      : %d/31 (99 or -1 = unknown)\r\n", g_signalQuality);
  Serial.printf("        Registered  : %s\r\n", g_networkReady ? "yes" : "no");
  Serial.printf("        IP address  : %s\r\n", g_modemIp.c_str());
}

void reportCrash(const ImuShared& imu) {
  if (g_crash.active) {
    uint32_t elapsed = millis() - g_crash.impactMs;
    uint32_t left = (elapsed < CRASH_CONFIRM_WINDOW_MS) ? (CRASH_CONFIRM_WINDOW_MS - elapsed) / 1000 : 0;
    String speed = g_crash.sawSpeed ? String(g_crash.lastSpeedKmh, 1) + " km/h" : String("no GPS yet");
    Serial.printf("[CRASH] CHECKING possible crash: %.2f g peak, %lu s ago, speed %s, decides within %lu s\r\n",
                  g_crash.peakG, (unsigned long)(elapsed / 1000), speed.c_str(), (unsigned long)left);
  } else {
    Serial.printf("[CRASH] idle  impacts %lu  confirmed %lu  ignored %lu",
                  (unsigned long)imu.impacts, (unsigned long)g_crash.confirmed,
                  (unsigned long)g_crash.ignored);
    if (imu.impacts > 0) Serial.printf("  last peak %.2f g", g_crash.lastPeakG);
    Serial.println();
  }
}

void reportBuffer(uint32_t now) {
  uint32_t permille = (g_buffer.count * 1000) / (BUFFER_MAX_FILES * RECORDS_PER_FILE);
  Serial.printf("[BUF]   FLASH %s  %lu unsent record(s) (%lu.%lu%% full)%s  recording every %lu s\r\n",
                g_buffer.ready ? "OK" : "UNAVAILABLE", (unsigned long)g_buffer.count,
                (unsigned long)(permille / 10), (unsigned long)(permille % 10),
                g_buffer.full ? "  FULL" : "", (unsigned long)(telemetryRecordPeriod() / 1000));
  if (g_link.up) {
    Serial.printf("        backend UP (last HTTP %d)  sent %lu  failed %lu\r\n", g_link.lastStatus,
                  (unsigned long)g_telemetrySent, (unsigned long)g_telemetryFailed);
  } else {
    uint32_t waited = now - g_link.failedAtMs;
    uint32_t left = (waited < RETRY_MS) ? (RETRY_MS - waited) / 1000 : 0;
    Serial.printf("        backend DOWN (last code %d)  next try in %lu s  sent %lu  failed %lu\r\n",
                  g_link.lastStatus, (unsigned long)left, (unsigned long)g_telemetrySent,
                  (unsigned long)g_telemetryFailed);
  }
}

void reportSystem(void) {
  Serial.printf("[SYS]   fw %s  heap %lu B (min %lu B)  OTA %s\r\n",
                FW_VERSION, (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getMinFreeHeap(),
                FEATURE_OTA ? "ENABLED" : "DISABLED");
  if (!g_provisioned) credsPrint();
}

void reportPrint(uint32_t now) {
  ImuShared imu;
  imuSnapshot(imu);
  Serial.printf("\r\n=================== K-TRACK STATUS  (uptime %lu s) ===================\r\n",
                (unsigned long)(now / 1000));
  reportGnss();
  reportImu(imu, now);
  reportNetwork();
  reportBuffer(now);
  reportCrash(imu);
  reportSystem();
  Serial.println("======================================================================");
}

/* ============================== CRASH CHECK ================================ */
// Records one crash (current fix, or the last good one, plus peak g) and
// starts the CRASH_QUIET_MS quiet period.
void crashConfirm(void) {
  g_crash.active = false;
  g_crash.confirmed++;
  g_crash.alerted = true;
  g_crash.alertMs = millis();
  Serial.printf("\r\n!!! CRASH CONFIRMED (vehicle stopped): %.2f g peak - sending alert !!!\r\n",
                g_crash.peakG);
  telemetryEnqueue(true, g_crash.peakG);
}

// Starts the GPS speed watch for a possible crash. Ignored within
// CRASH_QUIET_MS of the last alert; during a watch it only raises the peak.
void crashStart(uint32_t impactMs, float peakG) {
  if (g_crash.alerted && !timeElapsed(millis(), g_crash.alertMs, CRASH_QUIET_MS)) {
    Serial.printf("[CRASH] %.2f g impact ignored: within %lu s of the last alert\r\n",
                  peakG, (unsigned long)(CRASH_QUIET_MS / 1000));
    return;
  }
  if (g_crash.active) {
    if (peakG > g_crash.peakG) g_crash.peakG = peakG;
    g_crash.lastPeakG = g_crash.peakG;
    return;
  }
  g_crash.lastPeakG = peakG;
  g_crash.active = true;
  g_crash.impactMs = impactMs;
  g_crash.peakG = peakG;
  g_crash.sawSpeed = false;
  g_crash.lastSpeedKmh = 0;
  g_crash.lastPollMs = millis() - CRASH_GPS_POLL_MS;   // read GPS straight away
  Serial.printf("\r\n!!! POSSIBLE CRASH: %.2f g impact - watching GPS speed for %lu s !!!\r\n",
                peakG, (unsigned long)(CRASH_CONFIRM_WINDOW_MS / 1000));
}

// Polls GPS every CRASH_GPS_POLL_MS. Below CRASH_STOP_KMH = crash. Window
// over while still moving, or without any GPS speed = ignored.
void crashCheckSpeed(void) {
  uint32_t now = millis();
  if (timeElapsed(now, g_crash.lastPollMs, CRASH_GPS_POLL_MS)) {
    g_crash.lastPollMs = now;
    gnssPoll();
    if (g_fix.valid) {
      g_crash.sawSpeed = true;
      g_crash.lastSpeedKmh = (g_fix.speedKmh < 0.0f) ? 0.0f : g_fix.speedKmh;
      if (g_crash.lastSpeedKmh < CRASH_STOP_KMH) {
        crashConfirm();
        return;
      }
    }
  }
  if (!timeElapsed(now, g_crash.impactMs, CRASH_CONFIRM_WINDOW_MS)) return;
  g_crash.active = false;
  g_crash.ignored++;
  if (g_crash.sawSpeed) {
    Serial.printf("[CRASH] %.2f g impact ignored: still moving at %.1f km/h after %lu s (pothole or bump)\r\n",
                  g_crash.peakG, g_crash.lastSpeedKmh, (unsigned long)(CRASH_CONFIRM_WINDOW_MS / 1000));
  } else {
    Serial.printf("[CRASH] %.2f g impact ignored: no GPS speed during the window\r\n", g_crash.peakG);
  }
}

void crashService(void) {
  uint32_t impactMs = 0;
  float peakG = 0.0f;
  if (imuTakeImpact(impactMs, peakG)) crashStart(impactMs, peakG);
  if (g_crash.active) crashCheckSpeed();
}

/* ============================== MAIN LOOP ================================== */
const char* resetReasonText(void) {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:   return "power on";
    case ESP_RST_EXT:       return "reset pin";
    case ESP_RST_SW:        return "software restart (OTA update or ESP.restart)";
    case ESP_RST_PANIC:     return "firmware crash (panic)";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:       return "watchdog (firmware stuck)";
    case ESP_RST_BROWNOUT:  return "BROWNOUT - supply voltage dipped";
    case ESP_RST_DEEPSLEEP: return "wake from deep sleep";
    default:                return "unknown";
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  credsLoad();
  Serial.println("\r\n\r\n==================================================================");
  Serial.printf("  K-Track tracker firmware v%s   device %s\r\n", FW_VERSION,
                g_provisioned ? g_deviceId : "(not provisioned)");
  Serial.printf("  last reset: %s\r\n", resetReasonText());
  Serial.println("==================================================================");
  credsPrint();

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_CLOCK_HZ);
  Wire.setTimeOut(20);
  SerialAT.setRxBufferSize(MODEM_RX_BUF);   // must come before begin()
  SerialAT.begin(MODEM_BAUD, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);
  delay(500);

  Serial.println("\r\n  ===================== START-UP CHECKS =====================");
  bool checksOk = runStartupChecks();
  otaConfirmOrRollback(checksOk);   // reboots here if a trial firmware failed
  if (g_modemOk) modemConfigureTls();

  uint32_t now = millis();
  g_lastReportMs = now;
  g_lastTelemetryMs = now;
  g_lastDataRetryMs = now - DATA_RETRY_MS;   // first data attach right away
  g_lastOtaMs = now - OTA_PERIOD_MS;         // first OTA check right away
}

void loop() {
  consoleService();
  crashService();
  uint32_t now = millis();
  bool gpsRead = false;
  if (timeElapsed(now, g_lastReportMs, REPORT_PERIOD_MS)) {
    if (modemCheckAlive()) {         // a lost modem is not queried: each query would wait 3 s
      gnssPoll();
      gpsRead = true;
      g_signalQuality = modemSignalQuality();
      g_networkReady = modemNetworkRegistered();
      g_modemIp = g_networkReady ? modemLocalIp() : String("none");
    }
    reportPrint(now);
    g_lastReportMs = now;
  }
  if (g_modemOk && g_networkReady && g_modemIp == "none" &&
      timeElapsed(now, g_lastDataRetryMs, DATA_RETRY_MS)) {
    g_lastDataRetryMs = now;
    bool up = modemDataConnect(APN);
    Serial.printf("[NET]   mobile data %s  IP %s\r\n", up ? "attached" : "attach FAILED", g_modemIp.c_str());
  }
  if (timeElapsed(now, g_lastTelemetryMs, telemetryRecordPeriod())) {
    g_lastTelemetryMs = now;
    if (!gpsRead) gnssPoll();        // fresh fix, unless the report just read it
    telemetryEnqueue(false, 0.0f);
  }
  telemetryService(millis());
  if (FEATURE_OTA && g_modemOk && timeElapsed(now, g_lastOtaMs, OTA_PERIOD_MS)) {
    g_lastOtaMs = now;
    otaCheck();
  }
  sleepWhileFullAndOffline();
  delay(LOOP_IDLE_MS);
}
