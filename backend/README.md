# K-Track — Vehicle Tracker (Firmware + Backend)

K-Track is a vehicle GPS tracker built around an **ESP32**, an **MPU6050** motion sensor and a **SIMCom A7608E-H** 4G LTE + GNSS modem. It records position, speed and crash events and sends them over HTTPS to a backend. When the backend can't be reached, it stores them in flash. It can update its own firmware over the air (OTA).

This README documents the whole system as it stands now, how it got here version by version, and every problem hit and fixed along the way.

> **Status (29 Sep 2026)**
> - Firmware source: **`FW_VERSION` 3.6.0**: UTC timestamps with milliseconds, no send timing, OTA checked every minute in 16 KB pieces, and the no-fix coordinates bug fixed (§9, E36). Compiles for ESP32 (441,661 bytes of flash, 25,896 bytes of RAM). Not yet flashed.
> - Tracker: runs **3.4.0**, installed over the air on 29 Sep 2026.
> - **First successful OTA update, 29 Sep 2026:** the tracker went from 3.3.0 to 3.4.0 over the air (443,792-byte image, 19 pieces of 24 KB). The first millisecond-stamped record arrived at 10:55:39.197.
>   - The installed image is an **early 3.4.0 build**. It has the millisecond clock and `[RTT]` timing, but not the later OTA fixes: it still downloads with the merged header that the server works around (§9, E29).
>   - Build the next update from the current source, with a higher version.
> - **`version_4/version_4.ino` (v4.0.0):** a simpler beginner-style rewrite of 3.6 (§7). Not yet flashed.
> - Backend: **`tracker-api.js`** (Node.js) is now the real backend, deployed on Render. It stores records in the PostgreSQL/PostGIS database, serves OTA, and pushes live updates to the dashboard (the Next.js app in the repo root, on Vercel). See §5.

---

## Contents

1. [Files in this folder](#1-files-in-this-folder)
2. [System architecture](#2-system-architecture)
3. [Hardware, wiring and flash layout](#3-hardware-wiring-and-flash-layout)
4. [Firmware reference (v3.6.0)](#4-firmware-reference-v360)
5. [Backend reference (`tracker-api.js`)](#5-backend-reference-tracker-apijs)
6. [How to run, flash and update](#6-how-to-run-flash-and-update)
7. [Firmware version history](#7-firmware-version-history)
8. [Backend version history](#8-backend-version-history)
9. [Problems encountered and how they were fixed](#9-problems-encountered-and-how-they-were-fixed)
10. [Measurements and estimates](#10-measurements-and-estimates)
11. [Known limitations and open items](#11-known-limitations-and-open-items)
12. [Troubleshooting quick reference](#12-troubleshooting-quick-reference)

---

## 1. Files in this folder

| File / folder | What it is | Status |
|---|---|---|
| `esp32_sim7608_gps_tracker.ino` | Tracker firmware (Arduino sketch, ~1,900 lines) | **Current**, v3.6.0 |
| `tracker-api.js` | Backend: telemetry ingest into the database, OTA download, live WebSocket push | **Current** |
| `package.json` | Its dependencies: `pg`, `ws`, `bcryptjs`, `jsonwebtoken` | Run `npm install` once |
| `.env` | `DATABASE_URL=…` and `JWT_SECRET=…`, read automatically by `tracker-api.js` | Keep private, never commit |
| `README.md` | This document | |

---

## 2. System architecture

```
 ┌──────────────────────── Tracker ────────────────────────┐
 │  MPU6050 ──I2C──┐                                        │
 │  (100 Hz, core 0)│      ESP32 (Arduino)                   │
 │                  ├──> crash detection, GPS-locked clock,  │
 │  A7608E-H  ──UART┘     JSON records, flash buffer, OTA    │
 │  (LTE + GNSS)                                            │
 └──────────────┬───────────────────────────────────────────┘
                │  HTTPS (TLS inside the modem), Jazz 4G, APN "jazz"
                ▼
   TLS-terminating edge — VS Code dev tunnel (*.devtunnels.ms)
                        or Render (*.onrender.com)
                │  plain HTTP
                ▼
   tracker-api.js  (Node http server, port $PORT or 33430)
     ├─ POST /api/tracker-data  ← telemetry → PostgreSQL/PostGIS (Neon)
     ├─ GET  /api/firmware/latest, /firmware/<file>.bin?range=a-b  → OTA
     └─ WS   /ws                → live positions and alerts to the dashboard

   Dashboard: the Next.js app on Vercel (same database). The operator
   registers trackers and uploads firmware there.
```

**Key design decisions**

- **Raw AT commands, no modem library.** TinyGSM was tried in v3.0.0 and dropped (§7). The modem's built-in HTTP(S) client (`AT+HTTPINIT/HTTPPARA/HTTPDATA/HTTPACTION/HTTPREAD`) handles TLS.
- **TLS is terminated at the edge.** The dev tunnel and Render both present a real certificate and forward plain HTTP. `tracker-api.js` is therefore a plain `http` server (§9, E9). The tracker still only ever talks HTTPS.
- **Live first, buffer only when offline.** Records go straight to the backend. Flash is written only after the backend has been declared unreachable (§4.6).
- **One boolean marks a crash.** A crash is an ordinary record with `crash: true`. There is no separate queue and no priority.
- **Time is GPS time in UTC,** sent with milliseconds (`YYYY-MM-DDTHH:MM:SS.mmmZ`).

---

## 3. Hardware, wiring and flash layout

### Wiring

| Signal | ESP32 | Module |
|---|---|---|
| I2C SDA | GPIO21 | MPU6050 SDA |
| I2C SCL | GPIO22 | MPU6050 SCL |
| UART RX2 | GPIO16 | A7608E-H TX |
| UART TX2 | GPIO17 | A7608E-H RX |
| Power | 3.3 V → MPU6050 VCC | |
| Ground | GND | common to all boards (required for the UART to work) |

- **I2C:** 400 kHz, `Wire.setTimeOut(20)`.
- **Modem UART:** 115200 baud 8N1, with a 4 KB receive buffer, enough for 1 KB `AT+HTTPREAD` chunks.

### Arduino IDE settings

- **Board:** ESP32 Dev Module.
- **Partition scheme:** **Default 4MB with spiffs**.
- **Serial Monitor:** 115200 baud.
- **Library:** ArduinoJson by Benoit Blanchon, v6.21+ or v7. It is the only external library. LittleFS, Update, esp_ota_ops, esp_timer and mbedtls come with the ESP32 core. With v7 the compiler warns that `StaticJsonDocument` is deprecated. That's harmless.

### Flash layout ("Default 4MB with spiffs")

| Partition | Size | Used for |
|---|---|---|
| nvs | 20 KB | ESP32 settings |
| otadata | 8 KB | Which app slot boots next |
| **app0** | 1,280 KB (1,310,720 B) | Firmware slot A |
| **app1** | 1,280 KB | Firmware slot B (OTA writes into whichever slot isn't running) |
| spiffs → **LittleFS** | 1,408 KB | Offline buffer (`/kbuf`, capped at ~1 MB) |
| coredump | 64 KB | Crash dumps |

The firmware lives in app0/app1, not in the 1,408 KB data partition, so the buffer can never overwrite it. The 3.6.0 image is ~431 KB, about a third of a slot. The backend refuses uploads over 1,200 KB so an image that wouldn't fit fails at upload time, not on the device.

---

## 4. Firmware reference (v3.6.0)

### 4.1 Configuration (top of the sketch)

| Constant | Value | Meaning |
|---|---|---|
| `FW_VERSION` | `"3.6.0"` | Compared by OTA. **Must equal the version typed on the upload page** (§9, E30) |
| `DEVICE_ID` | `"TRK-0001"` | Sent as `device_id`. Must equal the Tracker ID registered on the dashboard's Devices page |
| `AUTH_TOKEN` | 64 hex chars | Sent as `Authorization: Bearer …`. Must equal the Device Token entered for this tracker on the dashboard's Devices page (stored there as a bcrypt hash) |
| `TELEMETRY_URL` | `https://d6v0336q-33430.inc1.devtunnels.ms/api/tracker-data` | The Render URL is kept in a comment below it |
| `OTA_MANIFEST_URL` | same host `/api/firmware/latest` | Change together with `TELEMETRY_URL` |
| `APN` | `"jazz"` | SIM operator APN |
| `FEATURE_TELEMETRY_SEND` / `FEATURE_OTA` | `true` / `true` | Switch either off for bench tests |

**Timing**

| Constant | Value |
|---|---|
| `IMU_PERIOD_MS` | 10 ms (100 Hz) |
| `REPORT_PERIOD_MS` | 5 s (also the GNSS poll interval) |
| `TELEMETRY_PERIOD_MS` | 5 s while connected |
| `OFFLINE_RECORD_PERIOD_MS` | 5 min while offline |
| `OTA_PERIOD_MS` | 1 min ("change the OTA time here") |
| `BUFFER_FULL_SLEEP_MS` | 5 min light sleep per cycle when the buffer is full |
| `FAIL_STREAK_LIMIT` | 5 consecutive failures, then offline mode |
| `RETRY_FAST_MS` × `RETRY_FAST_COUNT` | 5 s × 5 probes, then `RETRY_SLOW_MS` 300 s |
| `DRAIN_MAX_PER_PASS` / `DRAIN_BUDGET_MS` | 3 records / 4 s per loop pass |
| `HTTP_POST_WAIT_MS` / `HTTP_GET_WAIT_MS` / `HTTP_READ_WAIT_MS` | 30 s / 60 s / 10 s |
| `NETWORK_WAIT_MS` | 60 s (boot) |
| `GNSS_INFO_WINDOW_MS` | 15 s, polled every 3 s at boot |
| `DATA_RETRY_MS` | 60 s (re-attach mobile data if the IP is lost) |
| `CLOCK_SYNC_WINDOW_MS` / `CLOCK_STEP_MS` | 10 min / 2 s |
| `MPU_CALIBRATION_MS` | 5 s ("change the calibration time here") |

**Buffer**

| Constant | Value |
|---|---|
| `BUFFER_MAX_BYTES` | 1 MB |
| `AVG_RECORD_BYTES` | 160 B (worst-case line is 159 B) |
| `RECORDS_PER_FILE` | 100 |
| `BUFFER_MAX_FILES` | 66 (6,600 records) |
| `CURSOR_SAVE_EVERY` | 10 |

**OTA**

| Constant | Value |
|---|---|
| `OTA_RANGE_BYTES` | 16 KB per request ("change the OTA piece size here") |
| `OTA_CHUNK_SIZE` | 1 KB |
| `OTA_RANGE_RETRIES` | 3 requests in a row without progress |
| `MANIFEST_MAX_BYTES` | 2 KB |

### 4.2 Boot sequence (`setup()` → `runStartupChecks()`)

Each check prints `PASS`, `WARN` or `FAIL` with a plain-English detail line. **Critical** checks (MPU, modem, SIM) decide whether a freshly installed OTA image is kept.

1. **FLASH.** Mounts LittleFS (formats it on first use), then recovers the buffer: scans `/kbuf/*.jsonl`, applies the saved cursor and recounts unsent records. It also restores the dedup timestamp and detects an already-full buffer.
2. **MPU (critical).**
   - Reads `WHO_AM_I` and configures the sensor: 100 Hz output, ~94 Hz low-pass filter, ±1000 °/s, ±16 g.
   - **Calibrates for 5 s at rest**, which takes about 1,100 readings (§4.3).
   - Checks that the calibrated resting magnitude is between 9.5 and 10.1 m/s².
3. **IMU task.** Starts the 100 Hz task on core 0.
4. **MODEM (critical).** Up to 10 `AT` attempts, then `ATE0` and `AT+CMEE=2`.
5. **SIM (critical).** `AT+CPIN?` must return `READY`.
6. **NET.** Waits up to 60 s for `AT+CEREG?` or `AT+CGREG?` to report home (1) or roaming (5), then reads `AT+CSQ`.
7. **GPRS.** `AT+CGDCONT=1,"IP","jazz"`, then `AT+CGACT=1,1` if there's no IP yet, then reads the IP with `AT+CGPADDR=1`.
8. **GNSS.** `AT+CGNSSPWR=1`, then polls `AT+CGNSSINFO` for up to 15 s. No fix indoors is only a warning.
9. **OTA confirmation.** `otaConfirmOrRollback()`: a new image that booted "pending verify" is marked valid if the critical checks passed. Otherwise the bootloader rolls back to the previous firmware.
10. **TLS setup.** `modemConfigureTls()`: SSL context 0 with TLS 1.0–1.2, `authmode 0` (encrypted, certificate not verified) and SNI on.
11. **Link state.** Starts **online** (`g_link.online = true`). The first OTA check runs straight away.

### 4.3 MPU6050, calibration and crash detection

**Sampling**
- A FreeRTOS task (`imuTask`, core 0, priority 3) reads 14 bytes from register 0x3B every 10 ms.
- Each sample is converted to m/s² and rad/s, and the calibration offsets are subtracted.
- The accel and gyro magnitudes are calculated from the corrected values.
- Every sample carries `monoMs`, a 64-bit timestamp used to date a crash exactly.

**Calibration (`mpuCalibrate`)**
- Averages all readings taken during `MPU_CALIBRATION_MS` with the vehicle **still**.
- **Gyro offset:** the average reading on each axis, since a still gyro should read zero.
- **Accelerometer offset:** the axis with the largest average is taken as the gravity axis. It should read ±9.80665 m/s², and the other two should read 0. The difference is the offset.
- The offsets live in ESP32 RAM (`g_imuOffsets`), not in the sensor.
- This is software offset calibration. It converges in one pass, unlike tuning the sensor's own offset registers.

**Crash rule (`imuDetectCrash`)**

| Term | Threshold |
|---|---|
| `hiAccel` | \|a\| > **4 g** (39.2 m/s²) |
| `hiGyro` | \|ω\| > **3.5 rad/s** (≈ 200 °/s) |
| `suddenAccel` | Δ\|a\| between consecutive samples > 15 m/s² |
| `suddenGyro` | Δ\|ω\| > 3.0 rad/s |

- **A crash is flagged when** `(hiAccel && hiGyro) || (hiAccel && suddenGyro) || (suddenAccel && hiGyro)`.
- **Cooldown:** a 5 s cooldown gives one event per impact.
- **Hand-over to core 1:** a single-slot, spin-lock-protected hand-over (`imuPublish` → `imuTakeCrash`). `crashService()` then builds a crash record **stamped with the impact's own sample time**.

**Sensor recovery:** after 50 consecutive I2C read errors the sensor is reconfigured. This fixes a sensor that reset to its default ranges after a voltage dip. It **can't** detect a sensor that reset silently (reads still succeed), a broken wire or a dead chip (§11).

### 4.4 GNSS parsing

- **Command:** `AT+CGNSSINFO`, polled every 5 s in the report cycle.
- **Finding the fields:** A76xx firmware builds put a different number of satellite-count fields before latitude. The parser finds the `N/S` … `E/W` pair first and reads every other field relative to it.
- **Values read:** latitude and longitude (decimal degrees), date and time (with fraction), altitude, speed (knots → km/h), course, HDOP and satellites.
- **Valid fix:** mode 2 or 3, coordinates in range, not (0,0), and a readable GPS date and time.

### 4.5 Time: GPS clock, UTC, milliseconds

- `monoMs()` is `esp_timer_get_time()/1000`: 64-bit milliseconds since boot. Unlike `millis()` it never wraps.
- **Setting the clock (`clockSync`):** every accepted fix sets `UTC = monoMs() + g_timeOffsetMs`, using the fix's time including its fraction of a second.
- **Format:** `formatUtc()` prints `YYYY-MM-DDTHH:MM:SS.mmmZ`.
- **Resolution vs accuracy:** the resolution is 1 ms. Each fix, though, reaches the ESP32 some time after it was taken (up to ~1 s with 5 s polling), and since 3.6.0 the clock is simply set from each fix. So `recorded_at` can run up to ~1 s behind true time.
  - The 3.4/3.5 minimum-delay filter (`ClockSync`) brought that down to tens or hundreds of ms and could be restored.
  - True 1 ms accuracy would need the GNSS 1PPS pin (§11).
- **Old records:** `parseIsoTime()` reads any `Z` or `±hh:mm` time, with or without a fraction, so older buffered records (`+05:00`) still send after an update.
- **Serial report:** prints `ESP32 clock : … (set from GPS)`.

### 4.6 Telemetry records, link state and offline buffer

**Wire payload (exactly these seven fields, in this order):**

```json
{"device_id":"TRK-0001","latitude":33.6286354,"longitude":73.0689163,"speed":0.0,
 "crash":false,"recorded_at":"2026-09-28T16:50:41.545Z",
 "created_at":"2026-09-28T16:50:41.000Z"}
```

- `recorded_at`: the ESP32's clock at the moment the record was made.
- `created_at`: the GPS fix's own timestamp.
- `latitude`, `longitude` and `speed` always come from a current fix. (Only firmware before 3.6.0 could send them as `null`, for a crash without a fix.)
- The token travels only in the `Authorization` header, never in the body.

**Records**
- **Routine records** need a live fix and are skipped if the fix time hasn't advanced (dedup on `g_lastRecordUtcMs`).
- **Crashes** don't make a record of their own. A crash sets a flag (`g_crashAwaitingRecord`), and the **next GPS record** the tracker makes carries `crash: true`, with that record's real position and times. That applies whether the record is sent live, buffered, or used as a reconnect probe.
  - If that live send fails, the flag is set again, so the crash goes with the record after it.
  - With no fix, the crash waits until a fix returns.
  - An OTA update isn't started while a crash is waiting.
  - The Serial Monitor's crash report still shows the impact values and the last known position.

**Link state machine**

```
            ┌──────────── ONLINE (boot state) ────────────┐
            │ every 5 s: build record → send live          │
            │   2xx → sent                                 │
            │   fail → record DROPPED, failStreak++        │
            │ backlog (if any) drains 3/pass in background  │
            │   (a failed backlog record is skipped)        │
            └──────────── 5 failures in a row ─────────────┘
                                   │
                                   ▼
            ┌──────────────────── OFFLINE ─────────────────┐
            │ every 5 min: build record → bufferPush()      │
            │ reconnect probe: 5 s ×5, then every 300 s     │
            │   probe = oldest buffered record (kept on      │
            │   failure) or, if the buffer is empty, a fresh │
            │   record (buffered on failure)                 │
            │ no network/IP → counts as failed probe (-10)   │
            └──────────── any probe gets 2xx ───────────────┘
                                   │
                                   ▼ back to ONLINE (live sending resumes,
                                     backlog drains oldest-first in parallel,
                                     so arrival order can interleave)
```

**Buffer format**
- JSON Lines segment files `/kbuf/00000001.jsonl` …, 100 records each.
- The cursor file `/kbuf/cursor` (`firstSeq,byteOffset,linesSent`) is saved every 10 sent records and whenever a segment is released. Sending resumes at the right record after a power cut.
- Stored lines **exclude** `device_id` and the token. They are added in RAM at send time, so credentials never sit in flash.
- A line with no terminating newline (a write cut off by power loss) is a damaged segment and is skipped and counted. A line that doesn't parse is skipped and counted.
- A buffered record is removed only after a 2xx reply. The exception: while online, a record that fails is skipped so the backlog keeps moving.

**Buffer full**
- The buffer is **never overwritten**. At 66 segments new records are refused (`refusedFull++`).
- `loop()` then runs `bufferSleepCycle()` instead of normal work:
  - refresh the network state;
  - make one reconnect attempt;
  - resume if the backend answered or a segment was freed;
  - otherwise light-sleep for 5 min.
- Light sleep pauses both cores, so crash detection is paused while full. The modem itself stays in network idle (§10).

### 4.7 Modem HTTP(S) flow

**POST, one per record (`httpsPostJson`):**
1. `AT+HTTPTERM` (closes any leftover session), then `AT+HTTPINIT`.
2. `AT+HTTPPARA="URL","…"`, `AT+HTTPPARA="USERDATA","Authorization: Bearer <token>"` and `AT+HTTPPARA="SSLCFG",0`.
3. `AT+HTTPPARA="CONTENT","application/json"`.
4. `AT+HTTPDATA=<len>,10000`, wait for `DOWNLOAD`, send the JSON, wait for `OK`.
5. `AT+HTTPACTION=1`, wait up to 30 s for `+HTTPACTION: 1,<status>,<len>`.
6. `AT+HTTPTERM`.

**GET (OTA):** `AT+HTTPACTION=0`, then `AT+HTTPREAD=<offset>,<n>` in 1 KB pieces. The reply is `+HTTPREAD: <n>`, then the bytes, then `+HTTPREAD: 0`, as documented in SIMCom's A76xx HTTP manual.

**One custom header only.** USERDATA carries exactly one header. The A7608E-H sends a `\r\n` typed into it as literal text (§9, E29), so the OTA byte range goes in the URL (`?range=a-b`).

### 4.8 Send timing (removed in 3.6.0)

Versions 3.4.0–3.5.0 timed every successful send (setup, upload, request/response, total) and printed `[TX] delivered … in N ms` and a `[RTT]` summary. That code was removed in 3.6.0. Delivered records are counted in the `[BUF]` block (`sent N`).

### 4.9 OTA update

1. **Check.** Every minute, `GET /api/firmware/latest` returns `{"version","url","size","sha256"}`. The log shows `[OTA] manifest HTTP 200, <announced> bytes announced, <read> read`.
2. **Compare versions.** `otaIsNewer()` parses `%d.%d.%d` for both versions and compares major, then minor, then patch as numbers (3.10.0 > 3.9.0). Equal or older versions never install. A version that isn't three numbers (e.g. `v3.2`) counts as "not newer".
3. **Safety gate (`otaSafeToUpdate`).** All of these must hold:
   - a valid fix and a speed under 3 km/h (parked);
   - network registered and CSQ ≥ 10;
   - no crash report pending;
   - **the buffer is empty**.

   Otherwise the log shows `postponed`.
4. **Download.** `Update.begin(size)`, then 16 KB requests to `…/firmware-x.bin?range=a-b` (the server replies 206 Partial Content):
   - each response is read from the modem in 1 KB `HTTPREAD` chunks, and **each chunk is written straight to flash** with `Update.write()` and added to the SHA-256. No RAM buffer for the whole piece is needed.
   - if a request stops early, the next request **continues from the last byte written**, so nothing is written twice;
   - after 3 requests in a row that make no progress, the update stops and the old firmware stays.

5. **Verify and switch.** The SHA-256 must match the manifest, then `Update.end(true)` and a reboot. On failure, `Update.abort()` and the old firmware stays.
6. **Trial boot.** The new image boots as "pending verify" and is kept only if the critical boot checks pass. Otherwise it rolls back automatically (`verifyRollbackLater()` returns true so the core doesn't accept it early).

### 4.10 Serial Monitor report (every 5 s)

| Block | Contents |
|---|---|
| `[GPS]` | Every `AT+CGNSSINFO` field, one per line: fix type, satellites, latitude, longitude, altitude, speed, course, HDOP, fix time (UTC). Or the last known fix and its age. Plus the ESP32 clock line |
| `[IMU]` | Sample rate, \|a\| and \|ω\|, per-axis a and g, temperature, I2C error count |
| `[NET]` | Signal (CSQ, dBm, label), registration, IP address |
| `[JSON]` | The record that would be sent now |
| `[BUF]` | Unsent count and % full, segment range, newest timestamp, recording interval, oldest unsent line, recovered/refused/corrupt/write-error counters, ONLINE (last HTTP status, sent, failed+skipped) or OFFLINE (last code, next try in N s) |
| `[CRASH]` | Crash details (acceleration, rotation, location, fix age) or "none since last report" |
| `[SYS]` | Firmware version, free heap and minimum heap, OTA enabled |

---

## 5. Backend reference (`tracker-api.js`)

A single file using Node's built-in `http`, `fs`, `path` and `crypto` modules plus four packages: `pg` (PostgreSQL), `ws` (WebSocket), `bcryptjs` (device token check) and `jsonwebtoken` (dashboard tickets).

It is the only thing the tracker talks to. The dashboard is the Next.js app on Vercel; both use the same database on Neon.

### 5.1 Running it

```
npm install        (once)
node tracker-api.js
```

| Setting | Source | Default |
|---|---|---|
| Port | `process.env.PORT` (Render sets it) | 33430 |
| Database | `DATABASE_URL` (the Neon connection string) | none, required |
| Ticket secret | `JWT_SECRET` (same value as the dashboard) | none, required |
| Allowed dashboard | `FRONTEND_ORIGIN` (e.g. `https://<app>.vercel.app`) | any origin |
| Bind address | | `0.0.0.0` |

The `.env` loader never overrides a variable already set in the real environment, so Render's dashboard variables always win.

### 5.2 Routes

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/tracker-data` | Bearer device token | Ingest one record, or a batch (JSON array or `{"device_id":…,"records":[…]}`, max 256 KB / 500 records, processed oldest first). Replies **201** stored, **200** `stored:false` (duplicate or unusable record), **400**, **401**, **403** |
| `GET /api/firmware/latest` | Bearer device token | `{"version","url","size","sha256"}` for the highest version uploaded on the dashboard, or 404 before any upload. The `url` host comes from `X-Forwarded-Host` (or `Host`) |
| `GET /firmware/<file>.bin` | Bearer device token | Serves the image from the database. Honours `Range: bytes=a-b` **or** `?range=a-b` with **206** and `Content-Range`. 416 if out of range. 200 for the whole file |
| `WS /ws?token=<ticket>` | Ticket from the dashboard | Live `position` and `alert` messages for one logged-in dashboard user |
| `GET /`, `GET /healthz` | none | `{"ok":true}` for Render's health check |

### 5.3 What happens to a record

1. **Check the device.** `device_id` must be a tracker registered on the dashboard and the token must match its stored bcrypt hash. Nothing is written before this passes. A suspended tracker gets 403.
2. **Store the point** in `location_points` (with a PostGIS point). The same tracker and `recorded_at` is stored once, so a record re-sent after a lost reply is answered 200 `duplicate`.
3. **Crash.** `crash:true` adds a row to `alerts`.
4. **Live position.** If the record is the newest for that tracker, it becomes the tracker's live position. Buffered records sent after an outage are older, so they are stored for the trip but don't move the vehicle on the live map.
5. **Geofences.** If that newest point is on the other side of a geofence edge from the previous one, an entry or exit alert is added.
6. **Push.** The new position and any alert are sent at once to the open dashboards allowed to see that tracker.

A record with no usable position or time is answered **200 `stored:false`**, not an error. The firmware retries anything that isn't 2xx, and one such record in the offline buffer would block every record behind it.

### 5.4 Server behaviour worth knowing

- **Every JSON reply carries `Content-Length`.** Without it Node sends the body in chunks, and the modem then reports a 0-byte body (§9, E27).
- **Per-device tokens.** Each tracker has its own token, stored as a bcrypt hash. A token that has passed the check is remembered in memory, so bcrypt runs once per tracker per process, not on every record.
- **OTA requests carry no device ID.** The token is compared with each active tracker's hash.
- **Times are UTC.** `recorded_at` is stored as UTC whatever offset the record used (`Z` or `+05:00`).
- **Merged-header workaround (`splitMergedHeaders`).** A header like `Authorization: Bearer <key>\r\nRange: bytes=…` (literal backslashes, as sent by 3.3.x firmware) is split back into two headers.
- **Download link host.** The firmware download URL is built from `X-Forwarded-Host`, because a dev tunnel may rewrite `Host` to `localhost:<port>`.
- **Everything is persisted** in the database: positions, alerts and firmware images survive a restart or redeploy.
- **Live socket access.** A dashboard user gets a 2-minute ticket from the Next.js app and opens the socket with it. The admin receives all events, an owner their own trackers' positions and alerts, an invited viewer positions only.
- **Restart after editing.** Node doesn't reload a running script when the file changes.

---

## 6. How to run, flash and update

### 6.1 Local backend + VS Code dev tunnel (current test setup)

1. **Sync the laptop clock** (Settings → Time & language → Date & time → **Sync now**). Otherwise `received_at` is wrong (§9, E24).
2. **Start the backend:** `npm install` once, then `node tracker-api.js` (keep the terminal open). It needs `DATABASE_URL` and `JWT_SECRET` in `.env`.
3. **Forward the port.** In the VS Code **Ports** panel, forward port 33430 and set **Port Visibility → Public**. A private tunnel sends the modem to a sign-in page.
4. **Check reachability.** On a phone using **mobile data** (not Wi-Fi), open `https://<tunnel>/healthz`. You should see `{"ok":true,…}`.
5. **Point the firmware at the tunnel.** Put the tunnel URL (the **Forwarded Address**, not the terminal's `localhost` links) into `TELEMETRY_URL` and `OTA_MANIFEST_URL`, keeping the paths.
6. **Keep VS Code open,** because closing it closes the tunnel.

### 6.2 Render (deployment)

- **Service:** Web Service with root directory `backend`, build command `npm install`, start command `node tracker-api.js`, health check path `/healthz`. The `render.yaml` in the repo root describes exactly this. Render sets `PORT` itself.
- **Environment:** set `DATABASE_URL`, `JWT_SECRET` (same values as the dashboard on Vercel) and `FRONTEND_ORIGIN` in the dashboard. Don't upload `.env`.
- **Region:** pick **Singapore**. It's usually better connected from Pakistan than the Azure India relay the dev tunnel uses (§9, E26).
- **Firmware URLs:** switch both to `https://<service>.onrender.com/…`. The commented line under `TELEMETRY_URL` has the paths.
- **Dashboard:** set `BACKEND_URL=https://<service>.onrender.com` on Vercel so the dashboard receives live pushes.
- **Free plan:** the service sleeps when idle; a tracker reporting every 5 s keeps it awake. Firmware images are in the database, so nothing is lost on a restart.

### 6.3 Flashing over USB

1. Open **`esp32_sim7608_gps_tracker.ino`** (not an older copy such as `firmware_v9.ino`) and check the IDE settings in §3.
2. Upload, then open the Serial Monitor at 115200. Keep the vehicle still for the 5 s calibration.

### 6.4 OTA update procedure

1. **Bump the version.** Set a higher `FW_VERSION` in the sketch, e.g. `"3.4.1"`.
2. **Export the build.** **Sketch → Export Compiled Binary**, then use **`<sketch>.ino.bin`**. Check its timestamp.
   - **Never** upload `*.merged.bin`: it's the 4 MB bootloader + partition table + app image for USB flashing.
   - Don't upload `*.bootloader.bin`, `*.partitions.bin`, `boot_app0.bin`, `.elf`, `.map` or `*_flashed.bin` either.
3. **Upload it.** On the dashboard, open **Firmware** (admin), enter the **same version** as `FW_VERSION` and choose the file.
4. **Wait for the tracker.** It installs at its next check (every minute), once parked with CSQ ≥ 10 and an **empty buffer**.
5. **Watch the Serial Monitor for:**
   - `[OTA] 24576 / N bytes …`
   - the reboot
   - `[BOOT] firmware 3.4.1 running from slot 'app1'`
   - `update ACCEPTED`
   - at the next check, `[OTA] up to date`

---

## 7. Firmware version history

Versions are listed oldest to newest. "Header" means the version label in the file's top comment, which at times differed from `FW_VERSION` (§9, E16).

### Original sketch (pre-2.x)

- **Commands:** `AT+CGNSPWR` and `AT+CGNSINF`.
- **Sending:** one fix every **60 s**, over plain HTTP with an `X-API-Key` header, to the Express `server.js` (`POST /api/gps`).
- **Duplicates:** only new fixes were sent.
- **Missing:** no offline storage, IMU or OTA.

### v2.4.0 (strict NASA-style raw-AT firmware)

- **Code style:** raw AT commands written in a defensive coding style: `KT_ASSERT`, bounded loops, `textFormat` wrappers, capped function length.
- **IMU:** MPU6050 task on core 0 with crash detection and a **5 s cooldown**.
- **GNSS:** A76xx `AT+CGNSSINFO` parsing, anchored on the N/S and E/W fields.
- **Offline buffer:** **CSV** lines in LittleFS segments, one record per 10 s connected or 5 min offline, with cursor recovery.
- **Crash queue:** a separate queue, retried every 15 s and sent before other data.
- **OTA:** manifest, SHA-256, safety gate and trial-boot rollback, but **telemetry and OTA both disabled** for bench testing.
- **Changes during 2.4.0:**
  - The token moved from the JSON body to an `Authorization: Bearer` header. Token masking was removed, since there was nothing left to mask.
  - Storage changed from **CSV to JSON Lines** (`.jsonl`) for easier access. JSON records are about twice the size of CSV; that was accepted.
  - An attempt to match the proposal document: 5 s interval, a reused HTTP session, and `auth_token` in both the body and the header. Parts were reverted when testing through the tunnel broke.

### v3.0.0 (rewrite)

- **Coding style:** the NASA-style ceremony was removed in favour of ordinary Arduino style.
- **Libraries:** first attempt used **TinyGSM + ArduinoHttpClient + ArduinoJson**. TinyGSM's SIM7600 profile doesn't speak the A76xx GNSS commands, so GNSS stayed on raw AT.
- **Final version:** the user's fuller **raw-AT** rewrite was kept. TinyGSM was dropped, and ArduinoJson was kept for every JSON build and parse (§9, E13).
- **TLS behind Render and the tunnel:** `authmode 0` and **SNI on**, with URLs ready for Render.
- **MPU6050 calibration:** 500 samples (~2 s) at rest, with automatic gravity-axis detection. The rest check was tightened to 9.5–10.1 m/s².
- **OTA enabled,** with `OTA_MANIFEST_URL` on the same host as telemetry.
- **Crash queue behaviour:** first, a crash while offline was **not stored**. Then **crash priority was removed entirely**:
  - no crash queue, `crash.jsonl`, 15 s retry or crash-first sending;
  - a crash is an ordinary record with `crash:true`, and the only special treatment is that dedup doesn't skip it.
- **Timestamps:** changed from UTC `Z` to **Pakistan Standard Time `+05:00`**. Internal time stays UTC so comparisons stay correct.

### v3.1.0

- **Buffer never overwritten.** When it's full, new records are refused and the tracker light-sleeps 5 min per cycle (`bufferSleepCycle`). A full buffer is also detected at boot. `bufferDropOldestSegment()` is kept only to trim an oversized buffer at boot.
- **Roll, pitch and the complementary filter removed.** `imuUpdateAttitude`, `FILTER_ALPHA`, `RAD_TO_DEGF` and the related fields and prints are gone. Crash detection never used them.
- **Crash acceleration threshold** raised from 25 to **35 m/s²**. Gyro stayed at 3.5 rad/s.
- **JSON payload** set to exactly `device_id, latitude, longitude, speed, crash, recorded_at, created_at`. The Serial Monitor shows every GNSS field one per line, and CSQ is also shown in dBm with a label.
- **MPU accelerometer range** raised to **±16 g** (register 0x1C = 0x18, 2048 LSB/g) so hard impacts don't clip. Gyro is ±1000 °/s.
- **`recorded_at` and `created_at` swapped:** `recorded_at` is the ESP32's clock and `created_at` is the GPS time. The struct field was renamed `espUtc`.
- **Buffer size:** a **1 MB** byte cap (160 B per record → ~6,600 records) replaced the old "4 hours" sizing. The telemetry interval was confirmed at **5 s**.

### Header "v3.2.0" (`FW_VERSION` still "3.1.0")

- **Live-first sending.** Records are sent straight to the backend, and flash is used only for fallback. The failure streak before going offline went from 3 to **5**. This introduced `g_lastRecordUtc`, so dedup works whether or not a record touched the buffer.
- **Changes after the rules review:**
  1. The crash threshold became **4 g (39.2 m/s²)** and 3.5 rad/s.
  2. The I2C sensor-recovery behaviour was documented (reconfigure after 50 errors).
  3. **Reconnect timing:** 5 probes 5 s apart, then every 300 s. This replaced the old 15 s → 300 s doubling.
  4. **A failed live send is dropped, not buffered.** The buffer is written only while offline. `linkProbe()` was added for reconnecting while the buffer is empty.
  5. **OTA checked every 5 min,** with the "change the OTA time here" comment.
  6. OTA version comparison was documented (numeric major.minor.patch).
  7. **The buffer sleep time is 5 min.** A bug that kept the tracker asleep after it reconnected was fixed (§9, E17).
  8. **24 KB HTTP Range download** for OTA, with 3 retries per piece, writing to flash only once a piece is complete. The server gained Range support to match.
- **IMU calibration** changed from ~500 samples (~2 s) to a timed **5 s** (`MPU_CALIBRATION_MS`).

### v3.3.0

- `FW_VERSION` set to 3.3.0. It ran on the tracker until 29 Sep 2026, when it updated itself over the air to 3.4.0, using the server's merged-header workaround (§9, E29).

### v3.4.0

Installed on the tracker over the air on 29 Sep 2026 (an early build without the OTA fixes below).


- **Millisecond timing everywhere:**
  - 64-bit monotonic clock;
  - GPS fraction-of-second parsing;
  - `clockSync()` minimum-delay filter;
  - `…​.mmm+05:00` timestamps;
  - the buffer parser reads both old and new formats;
  - `AVG_RECORD_BYTES` 160 → 168, so the buffer is now 63 files and 6,300 records.
- **Crash records** stamped with the impact's IMU sample time.
- **Send timing:** each successful send is timed in parts (setup, upload, request/response, total), with `[TX]` and `[RTT]` output.
- **OTA fixes from testing on the device:**
  - The byte range moved into the URL (`?range=a-b`). USERDATA now carries only the `Authorization` header, and `httpBeginWithHeader()` was removed.
  - `httpReadChunk()` accepts `+HTTPREAD: DATA,<n>` and logs unexpected replies.
  - The update-check log shows announced versus read bytes.
- **Compile check:** ESP32 Dev Module, 443,469 B of program storage (33%) and 50,592 B of global RAM (15%).

### v3.5.0 (current source, 29 Sep 2026)

- **Timestamps back to UTC.**
  - `recorded_at` and `created_at` are sent as `YYYY-MM-DDTHH:MM:SS.mmmZ`, keeping millisecond precision.
  - `formatLocalTime()` became `formatUtc()`, and the Pakistan-offset constants were removed.
  - `parseIsoTime()` replaces the two fixed-length formats. It reads any `Z` or `±hh:mm` time, so records buffered by 3.3/3.4 (`+05:00`) still send correctly after the update.
  - Records are ~10 B shorter, so `AVG_RECORD_BYTES` went back to 160: 66 files, 6,600 records, ~22.9 days at 5 min.
- **Unnecessary code removed** (no behaviour change):
  - **Write-only state:** `g_mpuOk`, the `overwritten` counter, and the global `g_gnssOk` (now checked directly).
  - **Duplicate timestamp:** `ImuSample.tMs` duplicated `monoMs`. The crash cooldown and crash report now use `monoMs`.
  - **One-line wrappers:** `modemTestAT()` and `fileCountLines()`.
  - **Two near-identical JSON builders** merged into `recordToJson(record, withDeviceId, out)`.
  - **Redundant setup:** `g_link.online = true` in `setup()` (already the default).
  - **The 200-for-whole-file fallback in `otaFetchRange()`:** the backend always answers 206.
  - **The `+HTTPREAD: DATA,<n>` parsing:** not in the A76xx manual.
- **Comments cut back.** The ~115-line header became a 17-line summary pointing to this README, and comments that told the development history were shortened to what the code does.
- **Backend:** `received_at` is now UTC (`toISOString()`), matching the firmware.
- **Compile check:** 442,557 B of program storage (33%) and 50,552 B of global RAM (15%). The file shrank from 2,274 to 2,012 lines.
- Never flashed; superseded by 3.6.0.
- **Tests:** the new timestamp parser was checked on the new UTC form, the 3.4 form (`.197+05:00`), the 3.3 form (`+05:00`, no milliseconds) and malformed input. The backend was checked with UTC and `+05:00` records, and the OTA download test passes.

### v3.6.0 (current source, 29 Sep 2026)

- **Millisecond precision dropped, then restored.**
  - First the timestamps were cut to whole seconds (`2026-09-29T05:55:39Z`). Milliseconds were then put back on request (`….mmmZ`, GPS fraction read again, and the backend's `received_at` too).
  - The minimum-delay clock filter (`ClockSync`, 10-min windows, step detection) was replaced by setting the clock from each fix, and `fractionToMs()` was removed.
  - Older buffered records with fractions or `+05:00` are still read.
- **Send timing removed:** `SendTiming`, `RttStats`, `rttRecord()`, `reportRtt()`, the `[TX] delivered … ms` line and the `[RTT]` block. The backend's `delay_ms` was removed too.
- **OTA checked every minute** (`OTA_PERIOD_MS`, was 5 min). That's roughly 1,440 update checks a day, each a small HTTPS request (a few KB, mostly the TLS handshake).
- **OTA requests of 128 KB** (`OTA_RANGE_BYTES`, was 24 KB).
  - A 128 KB RAM buffer overflowed the ESP32's static RAM by 32 KB, so each response is now written to flash 1 KB at a time as it's read, and a stopped request continues from the last byte written.
  - Global RAM fell from 50.5 KB to 25.9 KB.
  - On the tracker, 128 KB pieces made the update noticeably **slower**. The likely cause is the modem not holding a whole 128 KB response, so reads wait on the network. The piece size was set to **16 KB**: 28 requests for a ~440 KB image. The streamed writing (1 KB at a time, resume after a partial request) was kept.
- **Fixed: coordinates sent without a GPS fix (E36).** Coordinates are sent only with a current fix, and a fix now needs a readable GPS time.
- **Crash sent with the next GPS record.** A crash no longer makes its own record (which could have `null` or stale coordinates). The next GPS record carries `crash: true`, and a failed live send passes the flag on to the record after it. `recorded_at` is therefore the time of that record, not the moment of impact; the Serial Monitor still reports the impact itself.
- **Compile check:** 441,273 B of program storage (33%) and 25,888 B of global RAM (7%).
- **Tests:** the backend served a 441,273-byte image as four 128 KB `?range=` pieces that rejoined byte-for-byte, and it kept the newest record when older backlog records arrived. The OTA download test passes.

### v4.0.0 (`version_4/version_4.ino`, simple rewrite, 29 Sep 2026)

A beginner-style rewrite of 3.6 in its own sketch folder. The 3.x file stays as it was.

- **Structure:**
  - no structs, only plain global variables;
  - `setup()` and `loop()` do the work as numbered steps: setup 1–7 (flash, MPU, modem, SIM, network, GPS/TLS, OTA check); loop 1–7 (crash flag, GPS + report, data re-attach, record, send saved records, OTA, buffer-full sleep);
  - 7 small helpers remain: `sendAT()`, `httpStart()`, `httpAction()`, `httpPost()`, `timeText()`, plus `imuTask()` and `verifyRollbackLater()`, which the ESP32 requires to be functions.
  - The file is ~700 lines, against ~1,900 for 3.6.
- **Same behaviour as 3.6:**
  - 100 Hz IMU on core 0 with 5 s calibration and the 4 g / 3.5 rad/s crash rule;
  - crash sent with the next GPS record;
  - live sending every 5 s, offline after 5 failures, retries at 5 s ×5 then 5 min;
  - flash buffer every 5 min while offline, 1 MB cap, 5-min sleep when full;
  - OTA every minute in 16 KB pieces written straight to flash, SHA-256, trial boot with rollback;
  - UTC timestamps with milliseconds.
- **Differences from 3.6:**
  - **Buffer:** one file `/buffer.jsonl` plus `/bufpos.txt` (the byte position sent so far), replacing the segment files and cursor. Lines are stored exactly as sent (with `device_id`), so they aren't parsed back. The file is deleted once everything is sent.
  - **The record that triggers offline mode is saved** instead of dropped, so reconnect attempts always have a record to send.
  - **A saved record that fails while online is kept** and tried again, instead of being skipped. No backlog data is lost this way.
  - **Old `/kbuf` folder deleted at boot.** An OTA update only installs with an empty buffer, so nothing is lost that way; a USB flash over a non-empty 3.x buffer would lose that backlog.
  - **Payload built with `snprintf`.** ArduinoJson is only used for the update information, and it must be version 7.
  - **Shorter report:** GPS on two lines, and the buffer shown in bytes rather than records.
  - **Removed:** the `FEATURE_*` switches.
  - **Calibration timing:** the IMU task now runs the calibration itself at 100 Hz (~500 readings in 5 s).
- **Compile check:** 421,717 B of program storage (32%) and 25,640 B of RAM (7%), with no warnings. Not yet tested on the tracker.

---

## 8. Backend version history

| Stage | Change |
|---|---|
| `server.js` | Express, `POST /api/gps` with `X-API-Key`, JSONL file storage, `/latest` and `/history`. **Obsolete.** Needs `npm install` (express) to even start (§9, E20) |
| `tracker-api.js` v1 | Standalone, no dependencies. Tracker posts JSON and the browser shows it |
| HTTPS attempt | `https.createServer` with a self-signed `cert.pem`/`key.pem` on port 3443, and certbot explored for `ktrack.com` (§9, E1–E2) |
| Auth | `Authorization: Bearer` header checked before the body is read. The `.env` loader was added and a stray `;` in `.env` removed (§9, E3) |
| Behind the dev tunnel | Switched to **plain `http`**, because the tunnel terminates TLS itself (§9, E9) |
| Live page (1st time) | Server-Sent Events auto-update. Later lost in a revert |
| Proposal alignment | Body `auth_token` with masking, then reverted to header auth (§9, E12) |
| Render-ready | `process.env.PORT`, bind to `0.0.0.0`, comments on TLS termination |
| OTA | `/ota` upload page, `/ota/upload`, `/api/firmware/latest`, `/firmware/<file>` with SHA-256 and a 1,200 KB cap |
| Range | `Range: bytes=a-b` → 206 / 416 |
| 28–29 Sep 2026 fixes | `PORT` from the environment again (it had been hardcoded) · OTA page text (5 min, not 6 h; version example) · `X-Forwarded-Host` for the download link · **SSE live page restored** · `received_at` + `delay_ms` (PKT, then UTC) · **`Content-Length` on every reply** · **merged-header split** + `?range=` support |
| 29 Sep 2026 (with firmware 3.6.0) | `delay_ms` removed · **"latest" = newest `recorded_at`**, so backlog records don't overwrite the live position |
| 3 Oct 2026 (integration with the dashboard) | **Records stored in PostgreSQL/PostGIS** (Neon) · per-device tokens checked against bcrypt hashes (the shared `TRACKER_API_KEY` is gone) · duplicate and batch handling · crash and geofence alerts · **WebSocket push** to the dashboard · OTA images read from the database (uploaded on the dashboard) · the open test page, `/events`, `/ota` and `GET /api/tracker-data` removed |

---

## 9. Problems encountered and how they were fixed

Each entry lists the symptom, the cause, the fix, and whether it's resolved.

### Setup and networking

**E1. The browser opened someone else's website.**
- **Cause:** the name typed (`ktrack.com`, a real domain) isn't ours. Its DNS points at another site.
- **Fix:** use `localhost` or the tunnel URL. ✅

**E2. certbot for `ktrack.com` couldn't work.**
- **Cause:** it needs a domain you own pointing at the machine, port 80 reachable from the internet, and Linux or WSL.
- **Fix:** self-signed certificate for testing, later made unnecessary by edge TLS (E9). ✅

**E3. The token would never match.**
- **Cause:** `.env` had a trailing `;`, and `node` doesn't read `.env` on its own.
- **Fix:** removed the `;` and added a built-in `.env` loader. ✅

**E4. The tracker can't reach `localhost` or the LAN address.**
- **Cause:** the mobile network can't route to a private address.
- **Fix:** router port-forward and a firewall rule were tried, then replaced by the VS Code dev tunnel. ✅

**E5. The dev tunnel sent the modem to a sign-in page.**
- **Cause:** the forwarded port was **Private**.
- **Fix:** Ports panel → Port Visibility → **Public**. ✅

**E6. Manual `AT+CIPOPEN`/`AT+CIPSEND` tests failed, and the firmware's commands were suspected to be wrong.**
- **Causes:**
  - `+CIPOPEN: 0,11` means the connection failed; `0,0` means success. `OK` alone means nothing.
  - A connection can close straight away (`+IPCLOSE`).
  - The **Arduino Serial Monitor can't send Ctrl+Z** (0x1A), which interactive `CIPSEND` needs. Use PuTTY or RealTerm, or `AT+CIPSEND=<id>,<len>`.
- **Result:** the test proved the modem, SIM and APN have working internet. Those commands are a separate family from the firmware's `AT+HTTP*`, so nothing in the firmware was wrong. ✅

**E7. There was no endpoint to look at.**
- **Cause:** `tracker-api.js` wasn't running (no `node.exe` process).
- **Fix:** start it and keep the terminal open. ✅

**E8. The tunnel returned 404 with `X-Served-By: tunnels-prod-rel-inc1…`.**
- **Cause:** that's the tunnel's own page. The forwarding session wasn't active.
- **Fix:** forward the port again and set it Public. ✅

**E9. Requests through the tunnel hung.**
- **Cause:** the tunnel terminates TLS and forwards **plain HTTP**, but the server was HTTPS and waited forever for a TLS handshake.
- **Fix:** `http.createServer`. The tracker still uses HTTPS to the tunnel. ✅

**E10. Tracker log showed `last code 502`.**
- **Cause:** the tunnel was up, but nothing was listening locally (the server was stopped).
- **Fix:** restart the server. 404 means "no tunnel"; 502 means "tunnel is up, no server". ✅

**E11. Changes didn't take effect, and a test hit `EADDRINUSE`.**
- **Cause:** the user's copy of the old server was still running. Node doesn't reload a changed file.
- **Fix:** Ctrl+C and restart after every edit. ✅

**E15. Vercel was considered for the backend.**
- **Cause:** serverless platforms (Vercel, Cloudflare Workers, Lambda) can't run a long-running `listen()` server or hold WebSockets.
- **Fix:** use Render or Cloud Run (or keep Vercel only for request/response parts). ✅ (decision)

### Code and structure

**E12. Every POST got 401 after a partial revert.**
- **Cause:** the backend checked the header while the firmware sent the token in the body.
- **Fix:** the firmware sends the header; the backend checks only the header. ✅

**E13. The `.ino` didn't compile.**
- **Cause:** two complete sketches (TinyGSM plus the raw-AT rewrite) were pasted into one file: duplicate structs and two `setup()`/`loop()`.
- **Fix:** kept the raw-AT version and moved calibration and OTA onto it. The file was rebuilt with the editor, after an in-place shell rewrite was blocked as risky. ✅

**E14. TinyGSM couldn't read GNSS.**
- **Cause:** its SIM7600 profile doesn't support the A76xx `AT+CGNSSINFO` format.
- **Fix:** GNSS on raw AT, then TinyGSM dropped entirely. ✅

**E16. `FW_VERSION` didn't match the header label (3.0.0 vs v3.1.0; 3.1.0 vs v3.2.0).**
- **Why it matters:** OTA compares `FW_VERSION`, so a mismatch invites wrong uploads.
- **Fix:** kept in sync. Now 3.6.0 in both. ✅

**E17. The tracker stayed asleep after reconnecting.**
- **Cause:** `bufferSleepCycle()` resumed only once a whole segment had been freed, which was about 2.8 h of draining.
- **Fix:** it also resumes as soon as the link is back online. ✅

**E18. Duplicate fixes after the live-first redesign.**
- **Cause:** dedup read the buffer's newest timestamp, which live-sent records never update.
- **Fix:** a dedicated `g_lastRecordUtc(Ms)`, restored from the buffer at boot. ✅

**E20. `node server.js` failed with "Cannot find module 'express'".**
- **Cause:** `server.js` is the obsolete Express backend, and `node_modules` was never installed.
- **Fix:** `npm install` (68 packages, 0 vulnerabilities) makes it start. **But it's incompatible with the tracker:** wrong route, `X-API-Key` instead of Bearer, old field names. Run **`tracker-api.js`** instead. ✅

**E21. The Render deploy would fail.**
- **Cause:** `PORT` had been hardcoded to 33430.
- **Fix:** `process.env.PORT || 33430`. ✅

**E22. The OTA page gave wrong guidance.**
- **Cause:** it said "6-hour check" and suggested version 3.0.1, lower than what was running.
- **Fix:** it now says 5 min, gives a current example version, and warns that the typed version must equal `FW_VERSION`. ✅

**E23. The OTA download link could point at `localhost`.**
- **Cause:** a dev tunnel may rewrite `Host` to `localhost:<port>`.
- **Fix:** use `X-Forwarded-Host` first. ✅

**E33. The IDE showed "cannot open source file" for ESP32 headers.**
- **Cause:** VS Code IntelliSense isn't set up for the ESP32 toolchain. It's not a compile error.
- **Check:** `arduino-cli compile --fqbn esp32:esp32:esp32` builds cleanly. ✅

**E34. JSON records are about twice as large as CSV.**
- **Cause:** field names repeat on every line.
- **Decision:** accepted for easier reading, and the capacity was recalculated. ✅ (decision)

### Time

**E24. `received_at` was earlier than `recorded_at` (server "received" 6.6 s before the tracker "recorded").**
- **Cause:** the **laptop clock was 8.4 s slow**. The Windows Time service wasn't running (`w32tm` offset +8.38 s against `time.windows.com`).
- **Result:** after correcting for it, that record took ~1.8–2.8 s from record to server.
- **Fix:** sync the clock (Settings → Sync now, or an admin shell running `net start w32time` and `w32tm /resync`). ⚠️ **Must be done by the user.** Until then `received_at` is wrong.

**E25. The delay couldn't be measured precisely.**
- **Cause:** 3.3.x timestamps have whole seconds only (±1 s).
- **Fix:** milliseconds in 3.4.0. ✅ (in source)

### Connectivity

**E26. Intermittent `code 714` on sends, then offline and buffering after 5 in a row.**
- **Meaning:** "connect socket failed" in SIMCom's A76xx HTTP error list. The address lookup worked (lookup failure would be 713), but the TCP connection to `20.207.70.99` (Azure Central India, the dev tunnel relay) failed.
- **Likely causes:**
  - Pakistan → India traffic takes a detour through other countries, and the tunnel adds a second trip back to the laptop.
  - Weak signal.
  - A new TLS connection opened every 5 s.
  - The Jazz data bundle running out (DNS keeps working while connections are blocked).
- **Why the relay is in India:** the tunnel region is chosen by the host laptop's location, and it can't be changed in VS Code.
- **Actions:** check the data balance; power-cycle the whole board (the modem keeps its state across an ESP32 reset); try Render in Singapore. ⏳ **Open.** Suggested firmware changes (not yet implemented): reset the PDP context after repeated 7xx errors, and keep one connection open.

**E32. Buffered records were lost during a drain that failed.**
- **Cause:** by design, while **online** a backlog record that fails is skipped so the backlog keeps moving. Up to 5 records per failure run are lost this way.
- **Status:** documented design behaviour ⚠️.

### OTA

**E27. `[OTA] manifest HTTP 200, 0 bytes` / `could not read manifest`.**
- **Cause:** the server replied without `Content-Length` (`Transfer-Encoding: chunked`, passed through by the tunnel), and the modem most likely reported a 0-byte body.
- **Fix:** `sendBody()` adds `Content-Length` to every JSON and HTML reply. Afterwards the tracker logged `manifest HTTP 200, 187 bytes`. ✅

**E28. Risk that `+HTTPREAD` reports its length in another format.**
- **Cause:** some SIMCom firmware prints `+HTTPREAD: DATA,<n>`.
- **Fix:** the parser took the number after the last comma (3.4.0 source). Removed again in 3.5.0: SIMCom's A76xx HTTP manual documents only `+HTTPREAD: <data_len>`, and unexpected replies are still logged. ✅

**E29. `[OTA] range 0-24575 refused: HTTP 401, 62 bytes` (×3), then `download stopped at 0 / 443792`.**
- **Cause:** the firmware put two headers into USERDATA, joined with a `\r\n` typed as text. The **A7608E-H sends it literally**, so the server received one header, `Authorization: Bearer <key>\r\nRange: bytes=0-24575`, and the key didn't match. 62 bytes is exactly the 401 error body.
- **Fixes:**
  - **Server:** `splitMergedHeaders()` splits that header back into two, so 3.3.x trackers can update without USB.
  - **Firmware 3.4.0:** a single header, with the range in the URL (`?range=a-b`), which the server also accepts.
- **Tests:** merged header → 206 with a correct 24,576-byte slice; `?range=` → 206; merged header with a wrong key → 401. ✅
- **Confirmed on the device, 29 Sep 2026:** the 3.3.0 tracker downloaded all 443,792 bytes with the workaround and updated to 3.4.0.

**E30. OTA "fails" or repeats forever.**
- **Cause:** uploaded files were labelled with versions that didn't match their contents:
  - `firmware-3.3.5.bin` and `firmware-3.4.5.bin` were byte-identical and contained `FW_VERSION` **3.3.3**. They were built from an older copy (`firmware_v9.ino`) without the 3.4.0 changes.
  - `firmware-3.4.7.bin` contained **3.4.0**.
- **Effect:** the tracker installs, boots as the older version, sees the "newer" label again and reinstalls every 5 min. That's ~430 KB of mobile data each time, and the version never changes.
- **Fix:** upload with **exactly** the `FW_VERSION` inside the file, built from the current sketch (§6.4). ✅ On 29 Sep 2026 the image was uploaded as `3.4.0`, matching what's inside, and installed once without repeating.

**E35. An error line appeared at boot right after the first successful OTA update (29 Sep 2026).**
- **What was seen:** after `[OTA] verified, rebooting into 3.4.0`, the log showed `E (222) esp_core_dump_flash: Core dump data check failed … Image checksum='ffffffff'`, partly garbled.
- **Cause:** it's not a fault. The ESP32 checks its 64 KB coredump partition on every start. The partition holds no saved crash report (it's erased, `0xFF`), and that is reported as a failed check.
- **Check:** the reset reason was `SW_CPU_RESET`, the firmware's own restart. The new firmware then passed its start-up checks and sent a millisecond-stamped record (10:55:39.197), which is only possible after `update ACCEPTED`.
- **Records stopping afterwards:** the tracker had been unplugged. Neither the update nor this message caused it.
- **Status:** safe to ignore (the line-by-line walk-through is in §12). ✅

**E36. The backend received coordinates while the tracker had no GPS fix (seen with 3.4.0).**
- **Cause 1 (firmware bug):** for a **crash** with no current fix, `telemetryMakeRecord()` sent the **last known** coordinates and stamped `created_at` with the **current** time. The backend saw what looked like a fresh position. Shaking the tracker indoors is enough to trigger this.
- **Cause 2 (firmware):** a fix whose GPS date/time couldn't be read still counted as valid, and it was stamped with the current time.
- **Cause 3 (backend display):** after an outage, the **backlog** of older buffered records (which do have coordinates) was sent and replaced the "latest record", even though the tracker had no fix at that moment.
- **Fixes (3.6.0):**
  - Coordinates are sent only with a current fix, and a crash is carried by the next GPS record rather than sent on its own.
  - A fix now needs a readable GPS time.
  - The backend keeps the record with the newest `recorded_at` as "latest".
- **Trade-off:** a crash in a place with no fix (e.g. a tunnel) reaches the backend only when a fix returns, with that position. The Serial Monitor prints it straight away. ✅

**E31. Unclear which of the build files to upload.**
- **Answer:** `<sketch>.ino.bin` (the app image). Not `merged.bin`, which is the 4 MB full-flash image and is rejected by the 1,200 KB cap. ✅

---

## 10. Measurements and estimates

| Item | Value | Basis |
|---|---|---|
| Record → server (one live record, 3.3.0) | **~1.8–2.8 s** | One record, corrected for the 8.4 s clock error |
| Where that time goes (estimated) | setup 100–300 ms · upload 20–60 ms · connection + TLS 300–1000+ ms · request/response 60–200 ms · tunnel +30–150 ms | Reasoned estimate; never measured (send timing was removed in 3.6.0) |
| Dev tunnel from the laptop | TCP connect 0.14–1.4 s, full request 1.6–3.1 s | curl, 28 Sep 2026 |
| Sub-100 ms? | Tracker-side processing: yes, with a kept-open connection · one-way delivery: often possible with a nearby server · full round trip: unlikely on LTE (60–150 ms per network round trip) | Analysis; not implemented |
| Mobile data at 5 s sending | **~100 MB/day** | ~5–8 KB per request, because each request opens a new TLS connection |
| OTA download | ~440 KB: 19 requests of 24 KB up to 3.5.0; 128 KB tried in 3.6.0 (slower on the device); 28 requests of 16 KB in 3.6.0 as built | Image size; 128 KB slowdown observed on the tracker |
| Buffer capacity (3.6.0) | 6,600 records (66 × 100) | Each line ≤ 159 B, budgeted at 160 B |
| Buffer fill time, 5 min interval | 12/h, 288/day → full in **~22.9 days** | |
| Buffer fill time, 3 min interval | 20/h, 480/day → full in **~13.1 days** (3.3.0: 6,600 records → ~13.75 days) | |
| Modem current, registered and idle, GNSS off, no sleep command | **~17–20 mA** | SIM7600-family hardware design; A7608 datasheet not machine-readable |
| Modem current in sleep mode (`AT+CSCLK=1` + DTR) | ~2.8–4.6 mA | Same source; **not used by the firmware** |

---

## 11. Known limitations and open items

**Open or needing action**
- **Code 714 connection failures** through the India relay (E26). Try Render in Singapore; consider a PDP reset after repeated 7xx errors.
- **The laptop clock must be synced** for `received_at` (E24).
- **Upload `.bin` files with the matching version** (E30).

**Firmware**
- **Clock accuracy:** GPS-locked but limited by the modem's hand-over delay. 1PPS wiring is needed for true 1 ms accuracy.
- **Connection per record:** each record opens a new TLS connection. This costs data and time and exposes each record to connection failures. A kept-open socket (`AT+CCHOPEN`/`CCHSEND`) would fix all three but is a rewrite of the send path.
- **Certificates:** `authmode 0` means the modem doesn't verify the server's certificate. For production, load a CA certificate and use `authmode 1`.
- **Modem power:** the modem isn't put to sleep during the ESP32's light sleep (~17–20 mA idle).
- **Crash detection pauses** while the buffer is full (light sleep stops both cores).
- **Silent sensor reset:** the MPU recovery can't detect it (a periodic read-back of `PWR_MGMT_1` would).
- **OTA "parked" check:** a single speed reading under 3 km/h. Production should require several minutes stationary.
- **Arrival order:** live records can arrive before older buffered records while catching up (timestamps are intact).
- **Online drain skips:** a failed backlog record is skipped while online (E32).

**Backend**
- **Token lookup for OTA:** the update check has no device ID, so the token is compared with every active tracker's hash. Fine for a small fleet; a large one would want the device ID in the request.
- **One process:** live pushes reach only the dashboards connected to this process, so the backend must run as a single instance.
- **TLS isn't enforced by the app itself** (the edge provides it).

**Differences from the proposal document**
- **WebSocket:** implemented (`/ws`).
- **Database:** PostgreSQL/PostGIS persistence, role-based access and per-device hashed tokens are implemented.
- **Session model:** the document describes one TLS session reused across sends; the firmware opens one per record.
- **Token location:** the document puts the token in the payload; here it's in the header.
- **Storage size:** Table 5.1 assumes 1 GB of storage; the board has ~1.4 MB of LittleFS (buffer capped at 1 MB).

---

## 12. Troubleshooting quick reference

### Firmware status codes (in `[TX]` / `[LINK]` / `[OTA]` lines)

| Code | Meaning | First thing to check |
|---|---|---|
| 200 / 201 / 206 | Success (206 = one OTA piece) | |
| 400 | Bad JSON or missing `device_id` | Payload |
| 401 | Unknown device, or wrong or missing token | `DEVICE_ID` and `AUTH_TOKEN` equal the Tracker ID and Device Token registered on the dashboard |
| 403 | Tracker suspended on the dashboard | Devices page → Reactivate |
| 404 (from the tunnel) | Tunnel not forwarding | Ports panel, Public |
| 404 on the update check | No firmware uploaded yet | Upload the `.bin` on the dashboard's Firmware page |
| 416 | OTA range past the end of the file | Wrong manifest size |
| 502 | Tunnel up, local server not running | Start `node tracker-api.js` |
| 7xx | Modem-side network error (SIMCom A76xx HTTP list). **713** = address lookup failed, **714** = connection failed, **715** = TLS handshake failed | Signal, data balance, power-cycle, server region |
| -1 | `AT+HTTPINIT` or parameters failed | Modem state; power-cycle |
| -2 | No `DOWNLOAD` prompt after `AT+HTTPDATA` | Modem busy or stuck |
| -3 | Body upload not acknowledged | UART wiring and baud rate |
| -4 | No `+HTTPACTION` within 30 s (POST) or 60 s (GET) | Network, server too slow |
| -5 | Malformed `+HTTPACTION` line | Modem firmware format |
| -10 | No registration or no IP (offline probe without network) | `[NET]` block, APN |

### Common log lines

| Log line | Meaning |
|---|---|
| `[OTA] postponed: vehicle not parked or weak network` | One of: no fix, moving, CSQ < 10, crash pending, **buffer not empty** |
| `[OTA] up to date` | The server's version isn't higher, or isn't in `x.y.z` form |
| `[OTA] manifest HTTP 200, 0 bytes announced` | The server sent no `Content-Length` (E27) |
| `[OTA] SHA-256 mismatch` | The image changed or was corrupted. Upload again |
| `[BUF] buffer FULL` | 6,600 records waiting; the tracker sleeps 5 min per cycle until the link returns |
| `[BOOT] … ROLLING BACK` | The new firmware failed MPU, modem or SIM checks; the previous slot boots |
| MPU `WARN` with a rest value outside 9.5–10.1 | The vehicle moved during the 5 s calibration. Reboot while still |
| `ESP32 clock : not set yet` | No GPS time yet. Records aren't made until the first fix |
| `E (222) esp_core_dump_flash: Core dump data check failed … Image checksum='ffffffff'` at boot | Harmless. The 64 KB coredump partition is empty (all `0xFF`) because no crash dump was ever saved, and the ESP32 core reports that as a failed check. It is not a crash. The garbled characters around it come from the serial port being reset while that line prints |
| `rst:0xc (SW_CPU_RESET)` | A deliberate restart by the firmware, e.g. after `[OTA] verified, rebooting into …`. A crash shows `Guru Meditation Error` or `rst:…PANIC…` / `TG1WDT` instead |

### Reading the boot log after an OTA update

This is a real log from the first OTA update (3.3.0 → 3.4.0, 29 Sep 2026), explained line by line.

```
[OTA] verified, rebooting into 3.4.0
```
Printed by the K-Track firmware. All 443,792 bytes arrived and the SHA-256 matched the server's. `Update.end(true)` then marked the other app slot to start next, and `ESP.restart()` restarted the chip on purpose.

```
ets Jul 29 2019 12:21:46
```
The first line on every reset: the build date of the ESP32's built-in ROM start-up code. It's the same on every ESP32.

```
rst:0xc (SW_CPU_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)
```
- **`rst`** is the reset reason. `0xc SW_CPU_RESET` means software asked for the restart, i.e. the planned OTA reboot.
  - A crash would show a panic or watchdog code, e.g. `TG1WDT_SYS_RESET`.
  - Power-on or the EN button shows `POWERON_RESET`.
- **`boot:0x13`** means a normal start from flash, not USB download mode.

```
configsip: 0, SPIWP:0xee
clk_drv:0x00,q_drv:0x00,d_drv:0x00,cs0_drv:0x00,hd_drv:0x00,wp_drv:0x00
mode:DIO, clock div:1
```
How the chip talks to its flash: pin settings, drive strengths (defaults) and dual-I/O mode. Informational only.

```
load:0x3fff0030,len:4876
ho 0 tail 12 room 4
load:0x40078000,len:16532
load:0x40080400,len:3500
entry 0x400805b4
```
The ROM copies the second-stage bootloader from flash into RAM in three pieces (address and length) and jumps to it. `ho 0 tail 12 room 4` is internal bookkeeping for the copy. The second-stage bootloader then reads `otadata`, picks the slot the update selected, and starts it. It prints nothing because logging is off in Arduino builds.

```
E (222) esp_core_dump_flash: Core dump data check failed:
Calculated checksum='eae74cc3'
Image checksum='ffffffff'
```
- **What it is:** a message from the ESP32 system software, printed 222 ms after the application started, before any K-Track code runs.
- **Background:** if the firmware ever crashes, the chip saves a crash report into the 64 KB coredump partition with a checksum. On every start it checks whether a valid report is stored.
- **Why it says "failed":** `ffffffff` is what erased flash reads as, so no report has ever been saved, and "nothing valid stored" is printed as an error.
- **What it doesn't mean:** nothing crashed, and the firmware, the update and the buffered data are unaffected. It is unrelated to OTA and probably appears on every start.
- **Garbled text:** in the captured log the words `esp_core_dump_flash` came out as `esp_core_0f^}���͡`, because a few bytes were scrambled while the serial port was being set up.
- **Removing it:** would mean changing the partition layout or erasing that area over USB. Not worth it; ignore it.

After this the K-Track firmware starts and prints its banner, the start-up checks, and then:
```
[BOOT] firmware 3.4.0 running from slot 'app1'
[BOOT] new firmware passed its checks: update ACCEPTED
```
If a critical check (MPU, modem or SIM) had failed, it would print `ROLLING BACK`, and the previous slot (3.3.0) would start instead.
