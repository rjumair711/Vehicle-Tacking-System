# K-Track / FleetTrack Pro – GPS Vehicle Tracking System

> **Documentation update: 13 November 2026.** Describes the system as it is in `main`: firmware v5.0.0, two-step trip loading with saved OSRM road matches, 1-hour login sessions. All SQL migrations in `prisma/sql/` (001–005) are applied to the Neon database.

A vehicle tracking system with real hardware data: a custom ESP32 tracker (GPS + 4G LTE + accelerometer) sends its position over HTTPS to a backend, and a web dashboard shows live positions, daily trips and alerts.

There is no mock data anywhere. Everything the dashboard shows comes from the database. Without hardware, `scripts/simulate-tracker.mjs` sends real authenticated records exactly like the tracker.

---

## 🧠 System Architecture

```text
 Tracker (ESP32 + MPU-6050 + SIMCom A7608E-H, 4G LTE + GNSS) ── final_firmware.ino
    │  HTTPS, one POST per record, Authorization: Bearer <device token>
    ▼
 Backend on Render ── backend/tracker-api.js
    ├─ POST /api/tracker-data        ← telemetry, every 3 s (every 30 s while the backend is down)
    ├─ GET  /api/firmware/latest     ← OTA update check, every minute
    ├─ GET  /firmware/<file>.bin     ← OTA download, in pieces
    └─ WS   /ws                      → live positions and alerts to the dashboard
    │                                              │
    ▼  SQL (pg)                                    │ WebSocket (wss)
 PostgreSQL + PostGIS on Neon                      │
    ▲  SQL (Prisma + raw SQL)                      ▼
 Dashboard on Vercel ── this Next.js app ──────► Browser
    └─ pages + /api/* for login, devices, customers, trips,
       alerts, geofences, sharing, settings, firmware upload
                              │
                              └─ OSRM /match (road matching of trip routes)
```

| Part | Where | What it does |
|---|---|---|
| **Firmware** | `final_firmware.ino` (repo root, v5.0.0) | Records GPS + crash data, buffers it in flash, sends it over HTTPS, OTA self-update |
| **Backend** | Render (`backend/`) | The only thing the tracker talks to: stores telemetry, creates crash/geofence alerts, serves firmware updates, pushes live updates |
| **Frontend** | Vercel (repo root) | The dashboard and the APIs it uses (login cookie) |
| **Database** | Neon | Shared by both |
| **Road matching** | OSRM (own server, or the public demo) | Snaps finished trip routes to roads |

---

# 🚀 Current System Status

```text
Authentication        → ✅ JWT cookie (1 hour) + bcrypt, password reset by email
Roles                 → ✅ Admin, vehicle owner, invited viewer
Devices               → ✅ Admin registers tracker + customer login in one step
GPS Ingestion         → ✅ Backend on Render, matches the firmware's wire format
Live Updates          → ✅ WebSocket push (falls back to 5 s refresh)
Trips                 → ✅ One per tracker per Pakistan-local day, route points archived
Trip Route Map        → ✅ Stored line shown at once, road-matched line swapped in when ready
Alerts                → ✅ Crash + geofence, pushed live, stored, can be resolved
Geofences             → ✅ Polygons drawn on the map per tracker
Location Sharing      → ✅ View-only viewers + expiring share links
Firmware OTA          → ✅ Upload on the dashboard, served to trackers by the backend
Mock data             → ✅ None
```

---

## 🚢 Deployment

Both services need the **same** `DATABASE_URL` and `JWT_SECRET`.

### 1. Backend on Render

`render.yaml` describes the service (New → Blueprint), or create a Web Service by hand:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Build command | `npm install` |
| Start command | `node tracker-api.js` |
| Region | Singapore |
| Health check path | `/healthz` |

Environment:

```text
DATABASE_URL     Neon connection string
JWT_SECRET       same value as on Vercel
FRONTEND_ORIGIN  https://<your-app>.vercel.app   (who may open the live socket)
```

### 2. Frontend on Vercel

Environment (see `.env.example`):

```text
DATABASE_URL               Neon connection string
JWT_SECRET                 secret for the login cookie
BACKEND_URL                https://<your-service>.onrender.com   (for live updates)

RESEND_API_KEY             Resend API key for password-reset emails
RESET_EMAIL_FROM           sender address for those emails
APP_URL                    https://<your-app>.vercel.app   (must be https; used in the reset link)

TRIP_TIME_ZONE             Asia/Karachi (default)
NEXT_PUBLIC_TRIP_TIME_ZONE Asia/Karachi (Trips page date labels)
TRIP_ROLLUP_ON_READ        true (default); finished days are rolled up when the trip list is read

OSRM_MATCH_BASE_URL        base URL of your OSRM server, e.g. https://osrm.example.com (no /match/v1/driving)
ALLOW_PUBLIC_OSRM          true = use the free public OSRM demo server, also in production (see below)
OSRM_MAX_MATCH_COORDS      optional; points per /match request, must be <= osrm-routed --max-matching-size (default 85, 10 on the demo)
OSRM_MAX_MATCH_RADIUS      optional; metres, only if osrm-routed runs with --max-matching-radius
TRIP_MATCH_DEBUG           optional; "1" logs per-chunk OSRM status/code/confidence (never coordinates)
```

Without `BACKEND_URL` the dashboard still works; it re-reads the data every 5 seconds instead of receiving pushes. Without the three reset-email variables, "Forgot password" answers *temporarily unavailable*.

### 3. Firmware

`final_firmware.ino` (Arduino IDE, board **ESP32 Dev Module**, partition scheme **Default 4MB with spiffs**, library **ArduinoJson** v6.21+ or v7).

The device identity is **not** in the source. Flash the firmware, open the Serial Monitor (115200 baud, line ending *Newline*) and provision each tracker once:

```text
provision TRK-0001 <device token>
```

It is stored in the ESP32's NVS, which OTA updates do not touch. Nothing is recorded or sent until it is set. `calibrate` recalibrates the MPU-6050 (board still). The backend URLs and APN are constants at the top of the sketch:

```cpp
const char* FW_VERSION       = "5.0.0";
const char* TELEMETRY_URL    = "https://ktrack-backend.onrender.com/api/tracker-data";
const char* OTA_MANIFEST_URL = "https://ktrack-backend.onrender.com/api/firmware/latest";
const char* APN              = "jazz";
```

Wiring: MPU SDA → GPIO21, SCL → GPIO22; modem TX → GPIO16, RX → GPIO17; common GND. `backend/README.md` documents the earlier firmware versions (up to v3.6.2) and their history; the `.ino` files in `backend/` are those older versions.

### 4. Register the tracker

Log in as admin → Devices → Add Device: Tracker ID, Device Token (the same token you provisioned), vehicle name and plate, and the customer (new account with name, email and password, or an existing customer).

---

## 📡 Tracker → Backend Contract

```text
POST /api/tracker-data
Authorization: Bearer <device token>
{"device_id":"TRK-0001","latitude":33.6286354,"longitude":73.0689163,"speed":0.0,
 "crash":false,"recorded_at":"2026-11-13T16:50:41.545Z"}
```

A crash record also carries `"peak_g": 3.42`. Older firmware also sent `created_at`; the backend accepts both.

| Reply | Meaning |
|---|---|
| 201 | Stored |
| 200 `stored:false` | Accepted but not stored: duplicate, no valid position, or bad timestamp. Answered 2xx on purpose so one unusable record cannot block the tracker's offline buffer |
| 400 | Invalid JSON or missing `device_id` (the tracker drops the record) |
| 401 | Unknown device or wrong token |
| 403 | Tracker suspended by the admin |

- `device_id` must be a registered tracker and the token must match its stored bcrypt hash. Both are checked before anything is written.
- Timestamps may end in `Z` or `+05:00`; they are stored in UTC. `(tracker_id, recorded_at)` is unique, so a record sent twice is stored once.
- A record older than the tracker's current position (offline backlog) is stored but does not move the tracker on the live map.
- A batch of buffered points can be sent as a JSON array or as `{"device_id":"…","records":[…]}`. It is processed in timestamp order and the reply counts `stored`, `duplicate` and `discarded`.
- `crash:true` creates a crash alert. Crossing a geofence edge creates a geofence alert.
- Every reply to the tracker carries `Content-Length` (the modem reads a chunked reply as 0 bytes).

### What the firmware does with the reply

- Each record is written to flash (LittleFS, 1 MB, about 8,800 records) **before** it is sent, and sent oldest-first, one record per HTTPS request.
- **2xx** removes it, **400** drops it, anything else (timeout `-4`, modem `6xx/7xx`, `5xx`, no mobile data `-10`) keeps it and pauses sending for 10 s.
- While the backend is down a record is taken every 30 s instead of 3 s: the buffer then holds about **73 hours**.
- Buffer full and backend still down: deep sleep for 1 minute, then try again.

---

## ⚡ Live Updates

1. The browser asks the dashboard for a ticket: `GET /api/realtime` returns the backend's socket address and a JWT valid for 2 minutes.
2. It opens `wss://<backend>/ws?token=<ticket>`.
3. As each record arrives, the backend pushes `position` and `alert` messages to the users allowed to see that tracker.
   - The admin receives everything.
   - An owner receives their own trackers' positions and alerts.
   - An invited viewer receives positions of shared vehicles only.
4. With the socket open, pages still re-read the server every 15 s for what is not pushed (a tracker going offline, new devices).
5. If the socket drops, the page reconnects with a new ticket (2 s, doubling up to 30 s) and re-reads the data every 5 seconds in the meantime. The dashboard shows **Live** or **Updating every 5 s**.

A tracker counts as **online** when a record arrived in the last 90 seconds. Public share-link pages (`/share/<token>`) do not use the socket; they refresh every 15 s.

---

## 🔐 Authentication & Roles

| Role | Who | Can do |
|---|---|---|
| **Fleet Administrator** | `admin@fleettrack.com` (detected by email) | Everything: all trackers, devices, customers, geofences, firmware |
| **Vehicle Owner** | A customer with at least one tracker | Their own trackers: live map, trips, alerts, geofences, sharing |
| **Invited Viewer** | A user with no tracker of their own and a vehicle shared with them | Live location of the shared vehicle only |

- **Login:** email + password; the server sets an `httpOnly` cookie holding a JWT. Both expire after **1 hour**, then the user is sent back to the login page.
- **Adding a device** (Devices → Add Device): the admin enters the tracker ID, device token, vehicle details and the customer. A new customer gets an account with the name, email and password the admin enters; an existing customer just gets the device added.
- **Customers page:** the admin can also create and delete customer accounts.
- **Passwords:** a user changes their own password in Settings (the current password is required). "Forgot password" on the login page emails a reset link valid for 15 minutes (via Resend; at most one request per minute per account). Passwords and device tokens are stored as bcrypt hashes.
- **Sharing** (Sharing page), two ways:
  - **Invite a viewer:** the owner enters the email of someone who already has an account; that person then sees the vehicle's live location only.
  - **Location link:** a public link (`/share/<token>`) valid for 15 minutes, 1 hour or 24 hours, showing either the live location or a fixed snapshot. The owner can revoke it at any time. Only a hash of the link token is stored.
- Every data API checks the login cookie and filters by ownership on the server.

---

## 🗄️ Database

The schema is managed with raw SQL on Neon. **Do NOT run `prisma migrate dev` or `prisma db push`.** Changes are in `prisma/sql/` and applied with:

```bash
node scripts/apply-sql.mjs prisma/sql/<file>.sql
```

| Migration | Adds | Applied |
|---|---|---|
| `001_hardware_integration.sql` | Tracker/telemetry columns, firmware releases, delete trigger | ✅ |
| `002_project_brief.sql` | Polygon geofences per tracker, alert dedupe, `tracker_shares` | ✅ |
| `003_password_reset_tokens.sql` | `password_reset_tokens` | ✅ |
| `003_trip_route_points.sql` | `trip_route_points` archive, `trip_history.route_archive_v2` | ✅ |
| `004_location_sharing.sql` | `tracker_share_links` | ✅ |
| `005_trip_matched_route.sql` | `trip_history.matched_route`, `matched_route_meta`, `matched_route_at` | ✅ (13 Nov 2026) |

After any change to `prisma/schema.prisma`, run `npx prisma generate`. Columns created by raw SQL are declared in the schema (`Unsupported(...)` for PostGIS) so Prisma never tries to drop them.

| Table | Purpose |
|---|---|
| `users` | Admin, customers and viewers (`username`, `email`, `password_hash`, `company`) |
| `trackers` | One per device: owner, `secret_token_hash` (bcrypt hash of the device token), name, plate, status (`ACTIVE` / `SUSPENDED`), and the last known position |
| `location_points` | Raw GPS points not yet rolled up (PostGIS point). Unique on `(tracker_id, recorded_at)` |
| `trip_history` | One row per tracker per finished day: start/end, distance, average and max speed, route (PostGIS LineString), and the saved road-matched route |
| `trip_route_points` | Per-point archive of each finished day's moving GPS observations (time, speed, PostGIS point), used to rebuild and road-match the route |
| `alerts` | Crash and geofence alerts (coordinates, speed, time, PostGIS point), with resolved state |
| `geofences` | A polygon (PostGIS) for one tracker, with alert on entry/exit |
| `tracker_shares` | Which viewer may see which tracker's live location |
| `tracker_share_links` | Public location links: token hash, live or snapshot, expiry, revoked time |
| `password_reset_tokens` | One pending reset per user: token hash and expiry |
| `user_settings` | Theme, speed unit, which alert types to show |
| `firmware_releases` | OTA images (`.bin` stored as `bytea`, with size and SHA-256) |

The tables `User`, `Vehicle`, `TrackingDevice` and `UserSettings` (capitalised) are left over from the first prototype and are not used.

**Data retention:** raw points are deleted once their day has been rolled up into `trip_history` and archived in `trip_route_points`. Trip summaries, archived route points and alerts are kept for the life of the account. There is no automatic purge by age.

---

## 🧭 Trips

### Product behavior

- **One trip per tracker per Pakistan-local calendar day** (`TRIP_TIME_ZONE`, default `Asia/Karachi`), built from the moving GPS points of that day. A day can include several driving and parking periods.
- **Today = Active** means today's points include at least two qualifying moving points; it **does not** mean the vehicle is moving now.
- **Previous days = Completed**, stored in `trip_history`.
- The **Trip history** screen offers vehicle cards, search by name/ID/plate, status filters, per-day grouping, distance, duration, average/max speed, and a **View road path** action.
- **View road path** opens `/dashboard/map?tripId=<id>&trackerId=<id>`, which switches the map to the historical route viewer. The live map keeps using `VehicleMap` and the WebSocket/polling workflow.

### How a trip is shown

1. `GET /api/trips` returns the **list** without any road matching.
2. Opening a trip calls `GET /api/trips?tripId=<id>`. It answers within a second or two with either the **saved road-matched route**, or the **route stored in the database** (`route_geojson`) plus `roadMatchPending: true`. The map draws it immediately.
3. If matching is pending, the page calls `GET /api/trips?tripId=<id>&match=1` in the background. The server cleans the GPS trace, matches it with OSRM in chunks and joins the pieces into one line.
4. When that answer is **complete**, the map swaps in the road-matched line. It does not re-zoom, so a view the user moved stays put. An incomplete answer (time limit or rate limit) is asked again, up to 4 times, each continuing where the last stopped. If matching fails, the stored line simply stays.
5. Completed trips are saved in `trip_history.matched_route` once matched, so every later view loads instantly and makes no OSRM call. Today's active trip is cached in memory for 5 minutes and never saved.

The route is one continuous blue line with a white casing. Sections estimated across missing GPS data (routed or straight connectors) are drawn **faded**; START and END are marked. The legend and the trip panel show **Matching to roads…** while step 3 runs.

Measured on the longest stored trip (548 points, 14.4 km) with the public demo server: first view 2.5 s, background match 45 s, later views 1.2 s.

Map matching is an estimate, not proof of the exact path. Parallel roads, GPS drift, tunnels and missing recordings can make some sections uncertain; such sections are shown faded, never as verified roads. Trips rolled up before per-point archiving can only be matched from their stored line.

### Road matching server

The matcher uses `OSRM_MATCH_BASE_URL` when it points at your own server. Otherwise it uses the public demo `router.project-osrm.org` **only** when `ALLOW_PUBLIC_OSRM=true`, or automatically in development. With neither set, the stored GPS line is shown with a "road matching isn't configured" notice. `/api/road-route` follows the same rule and requires login.

The public demo is free, but it:
- is rate-limited (the app throttles to 1 request/s per server instance, sends an identifying User-Agent, and retries once after 2 s on 429/5xx),
- has no uptime guarantee,
- accepts only 10 points per match request and about a 40 m radius, so a long trip needs many requests (budget 50 s per request, `maxDuration = 60` on `/api/trips`),
- **receives your trip coordinates** (a third-party, volunteer-run service).

#### Self-hosting OSRM for Pakistan (car profile, MLD)

```bash
mkdir osrm && cd osrm
wget https://download.geofabrik.de/asia/pakistan-latest.osm.pbf

docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/pakistan-latest.osm.pbf
docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/pakistan-latest.osrm
docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/pakistan-latest.osrm

docker run -d --restart unless-stopped -p 5000:5000 -v "$PWD:/data" \
  ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld --max-matching-size 100 /data/pakistan-latest.osrm
```

Put it behind HTTPS (e.g. Caddy or nginx), then set `OSRM_MATCH_BASE_URL=https://<your-osrm-host>` on Vercel. Re-run the three build steps when you refresh the extract. A trailing `/match/v1/driving` on the base URL is stripped. With your own server a long trip matches in seconds (85 points per request, 4 requests in parallel).

### Core thresholds and metrics

| Rule | Value / meaning |
|---|---|
| Minimum moving speed | `3 km/h` (`MOVING_SPEED_KMH`) |
| Implausible speed exclusion | More than `220 km/h` |
| GPS gap that splits the trace | More than `180 s` or `1 km` between points; not counted as travelled distance |
| Trace cleaning before matching | Duplicates and jumps removed, parked jitter collapsed, thinned to ~18 m (30 m on the demo server), sharp turns kept |
| Matching radius | `50 m`, one retry at `90 m` (capped at 40 m on the demo server) |
| Points per match request | 85 with overlap (10 on the demo server) |
| Distance | Filtered GPS segment distance in kilometres; **not** the OSRM road length |
| Average speed | Average of accepted moving speed samples; **not** time-weighted |
| Duration | Time from the first to the last moving GPS point, including parked time in between |
| Coordinate order | GeoJSON/OSRM is `[longitude, latitude]`; Leaflet is `[latitude, longitude]` |

### Rollup

`listTrips()` calls `rollUpFinishedDays()` when the trip list is read (`TRIP_ROLLUP_ON_READ`, default `true`). It archives finished days' moving points into `trip_route_points`, writes `trip_history`, and deletes the processed raw points. Set it to `false` only if another scheduled job does the rollup.

### Files

| Path | Responsibility |
|---|---|
| `app/dashboard/trips/page.tsx` | Trips screen and View road path navigation |
| `app/api/trips/route.ts` | Trip list; single trip in fast (stored) or `match=1` mode |
| `lib/trips.ts` | Live trip SQL, rollup/archive, access filter, saved matches, `getTrip(session, id, mode)` |
| `lib/trip-road-match.ts` | Trace cleaning, chunked OSRM matching, stitching, caching |
| `lib/osrm.ts` | Which OSRM server is used, throttling and retries |
| `hooks/mapPageClient.tsx` | Loads the trip, draws the stored line, runs the background match |
| `components/TripHistoryMap.tsx` | Leaflet map used only for trip view |
| `components/TripRouteLayer.tsx` | Draws the route, faded estimated sections, START/END |
| `components/TripRouteLegend.tsx` | Route legend and "Matching to roads…" status |
| `components/VehicleMap.tsx` | Live vehicle map |

### API response contract

**List:** `GET /api/trips` returns `{ "success": true, "trips": [...] }`.

**Detail:** `GET /api/trips?tripId=<id>[&match=1]` returns `{ "success": true, "trip": { ... } }`:

```json
{
  "success": true,
  "trip": {
    "id": "EXAMPLE_ID",
    "trackerId": "TRK-EXAMPLE",
    "trackerName": "Example vehicle",
    "startTime": "2026-11-08T06:00:00.000Z",
    "endTime": "2026-11-08T07:00:00.000Z",
    "distance": 5.2,
    "duration": 60,
    "averageSpeed": 22.1,
    "maxSpeed": 48.0,
    "status": "completed",
    "routeGeoJson": "{\"type\":\"LineString\",\"coordinates\":[[73.0689,33.6286],[73.0701,33.6292]]}",
    "routeLine": [[73.0689, 33.6286], [73.0695, 33.6289], [73.0701, 33.6292]],
    "inferredRanges": [],
    "roadMatchStatus": "matched",
    "roadMatchConfigured": true,
    "roadMatchPending": false,
    "roadMatchComplete": true,
    "gpsPointsCount": 100
  }
}
```

**Example values only**, not real tracker data.
- `routeLine` is the road-matched line; it is empty while `roadMatchPending` is true.
- `inferredRanges` are inclusive index ranges of `routeLine` that are estimated connectors.
- `roadMatchStatus` is `matched`, `partial` or `gps-only`.
- `roadMatchComplete: false` means matching stopped early; ask again.

Ownership is checked in `getTrip()` / `ownerFilter(session)`; trip traces are never exposed without login.

---

## 📦 Firmware OTA

Dashboard → **Firmware** (admin):

1. Set a higher `FW_VERSION` in the sketch and export `<sketch>.ino.bin`.
2. Upload the file with the same version. The upload is refused if the file is not an ESP32 app image, is over 1,200 KB, or does not contain the typed version.
3. Each tracker asks the backend (`/api/firmware/latest`) every minute and installs the highest version if it is newer than its own. The download is checked against its SHA-256, and the tracker rolls back if the new firmware does not start properly.

---

## 🌐 Dashboard API Routes (Vercel)

All need the login cookie unless marked public; **A** = admin only.

```text
POST /api/auth/login | logout          GET /api/auth/me
POST /api/auth/forgot-password          public; emails a reset link
POST /api/auth/reset-password           public; sets a new password with the emailed token
GET  /api/realtime                      ticket + address for the live socket
GET  /api/live-location                 trackers with last position and status
GET  /api/trackers                      POST (A)
GET  /api/trackers/[trackerId]          PATCH (A)  DELETE (A)
GET  /api/trackers/[trackerId]/shares   POST   DELETE ?userId=N   (owner or admin)
GET  /api/trackers/[trackerId]/share-links   POST   (owner or admin)
DELETE /api/trackers/[trackerId]/share-links/[linkId]   revoke a link
GET  /api/public/location/[token]       public; location behind a share link
GET  /api/trips                         list trips, no road matching
GET  /api/trips?tripId=X                one trip, stored route or saved match (fast)
GET  /api/trips?tripId=X&match=1        one trip, runs OSRM road matching
POST /api/trips/generate (A)            roll up finished days now
POST /api/road-route                    route between points (login; not used by the trip view)
GET  /api/alerts[?trackerId=X]          PATCH /api/alerts/[alertId]   (resolve)
GET  /api/geofences                     POST       PUT/DELETE /api/geofences/[id]   (owner or admin)
GET  /api/users (A)   POST (A)          DELETE /api/users/[id] (A)
GET  /api/settings    PUT               PUT /api/settings/password
GET  /api/firmware (A)   POST ?version=X (A)   DELETE ?version=X (A)
```

Pages: `/` (login, forgot password), `/reset-password`, `/share/[token]`, and `/dashboard` with `map`, `trips`, `devices`, `customers`, `alerts`, `geofences`, `sharing`, `firmware`, `settings`.

---

## 🧪 Running Locally and Testing Without the Hardware

```bash
# dashboard (http://localhost:3000)
npm install
npx prisma generate
npm run dev

# backend (http://localhost:33430) - needs backend/.env with DATABASE_URL and JWT_SECRET
cd backend
npm install
node tracker-api.js
```

Put `BACKEND_URL=http://localhost:33430` in the root `.env` to get live pushes locally. In development, road matching uses the public OSRM demo server automatically. Check types with `npx tsc --noEmit` and build with `npm run build`.

`scripts/simulate-tracker.mjs` sends records to the backend exactly as the firmware does:

```bash
# live drive, one record every 5 s, crash on record 5
node scripts/simulate-tracker.mjs --url http://localhost:33430 --device TRK-0001 --token <AUTH_TOKEN> --count 30 --crash 5

# replay an offline backlog from yesterday
node scripts/simulate-tracker.mjs --url http://localhost:33430 --device TRK-0001 --token <AUTH_TOKEN> --start 2026-10-02T06:00:00Z --interval 0 --count 100
```

Use the Render URL in `--url` to test the deployed backend.

**Manual checks worth repeating after trip changes:** parked tracker (no jitter trip), today's trip, a completed day, a long trip (stored line first, then the road route), a 180+ s GPS gap, delayed offline uploads from yesterday, no OSRM configured, another owner's tracker (access denied), the Pakistan midnight boundary, and the live map after returning from a trip.

---

## ⚠️ Known Limitations

- The tracker's payload has no battery, signal or firmware-version fields, so the dashboard does not show them.
- The modem does not verify the server's TLS certificate (`authmode 0` in the firmware).
- The firmware's update check and download carry the device token but no device ID, so the backend compares the token with each active tracker's hash (the result is then remembered in memory).
- Firmware v5.0.0 waits 30 s for a reply and does not reset the modem's data session after repeated `-4`/`7xx` errors (v4.0.1 did). If Render is asleep the first request can time out; the record is kept and retried.
- On Render's free plan the service may sleep when idle; regular telemetry keeps it awake while a tracker is driving.
- With the public OSRM demo, the first view of a long trip takes up to a minute to switch to the road-matched line (the stored line is shown meanwhile). A self-hosted OSRM server removes this.
- The in-memory OSRM caches are per server instance and are lost on restart; saved matches in the database are not.
- Login sessions last 1 hour and are not extended while the user is active.
- Archived trip points are kept indefinitely; review data retention and backups before large-scale use.

---

## 🛠️ Tech Stack

```text
Frontend   → Next.js (App Router), Tailwind, shadcn/ui        (Vercel)
Backend    → Node.js http + ws + pg (backend/tracker-api.js)  (Render)
Language   → TypeScript (dashboard), JavaScript (backend), C++ (firmware)
Database   → PostgreSQL + PostGIS (Neon)
ORM        → Prisma (+ raw SQL for PostGIS and trips)
Auth       → JWT cookie (1 h); bcrypt for passwords and device tokens
Email      → Resend (password-reset links)
Live       → WebSocket (wss), 5 s polling fallback
Map        → Leaflet / React Leaflet, OpenStreetMap tiles
Routing    → OSRM Match (own server or public demo) for trip road matching
Tracker    → ESP32 + MPU-6050 + SIMCom A7608E-H, firmware v5.0.0 (final_firmware.ino)
```

---

## 📜 License

MIT
