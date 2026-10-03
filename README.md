# K-Track / FleetTrack Pro – GPS Vehicle Tracking System

A vehicle tracking system with real hardware data: a custom ESP32 tracker (GPS + 4G LTE + accelerometer) sends its position over HTTPS to a backend, and a web dashboard shows live positions, daily trips and alerts.

There is no mock data anywhere. Everything the dashboard shows comes from the database.

---

## 🧠 System Architecture

```text
 Tracker (ESP32 + A7608E-H, 4G)
    │  HTTPS, Authorization: Bearer <device token>
    ▼
 Backend on Render ── backend/tracker-api.js
    ├─ POST /api/tracker-data        ← telemetry, every 5 s
    ├─ GET  /api/firmware/latest     ← OTA update check, every minute
    ├─ GET  /firmware/<file>.bin     ← OTA download, 16 KB pieces
    └─ WS   /ws                      → live positions and alerts to the dashboard
    │                                              │
    ▼  SQL                                         │ WebSocket (wss)
 PostgreSQL + PostGIS on Neon                      │
    ▲  SQL (Prisma)                                ▼
 Dashboard on Vercel ── this Next.js app ──────► Browser
    └─ pages + /api/* for login, devices, customers, trips,
       alerts, geofences, sharing, settings, firmware upload
```

| Part | Where | What it does |
|---|---|---|
| **Backend** | Render (`backend/`) | The only thing the tracker talks to: stores telemetry, serves firmware updates, pushes live updates |
| **Frontend** | Vercel (repo root) | The dashboard and the APIs it uses (login cookie) |
| **Database** | Neon | Shared by both |
| **Firmware** | `backend/esp32_sim7608_gps_tracker.ino` | Documented in `backend/README.md` |

---

# 🚀 Current System Status

```text
Authentication        → ✅ JWT cookie + DB
Roles                 → ✅ Admin, vehicle owner, invited viewer
Devices               → ✅ Admin registers tracker + customer login in one step
GPS Ingestion         → ✅ Backend on Render, matches the firmware's wire format
Live Updates          → ✅ WebSocket push (falls back to 5 s refresh)
Trips                 → ✅ One per tracker per day, today's trip shown live
Trip Route Map        → ✅ Road-following route (OSRM), start/end markers
Alerts                → ✅ Crash + geofence, pushed live, stored, can be resolved
Geofences             → ✅ Polygons drawn on the map per tracker
Location Sharing      → ✅ Owner invites a view-only viewer
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

Environment:

```text
DATABASE_URL     Neon connection string
JWT_SECRET       secret for the login cookie
BACKEND_URL      https://<your-service>.onrender.com   (for live updates)
TRIP_TIME_ZONE   optional, default Asia/Karachi
```

Without `BACKEND_URL` the dashboard still works; it re-reads the data every 5 seconds instead of receiving pushes.

### 3. Firmware

```cpp
const char* DEVICE_ID        = "TRK-0001";   // = Tracker ID on the Devices page
const char* AUTH_TOKEN       = "<64 hex>";   // = Device Token on the Devices page
const char* TELEMETRY_URL    = "https://<your-service>.onrender.com/api/tracker-data";
const char* OTA_MANIFEST_URL = "https://<your-service>.onrender.com/api/firmware/latest";
```

### 4. Register the tracker

Log in as admin → Devices → Add Device: Tracker ID, Device Token, vehicle name, customer email.

---

## 📡 Tracker → Backend Contract

```text
POST /api/tracker-data
Authorization: Bearer <AUTH_TOKEN>
{"device_id":"TRK-0001","latitude":33.6286354,"longitude":73.0689163,"speed":0.0,
 "crash":false,"recorded_at":"2026-09-28T16:50:41.545Z","created_at":"2026-09-28T16:50:41.000Z"}
```

| Reply | Meaning |
|---|---|
| 201 | Stored |
| 200 `stored:false` | Accepted but not stored: duplicate, no valid position, or bad timestamp. Answered 2xx on purpose so one unusable record cannot block the tracker's offline buffer |
| 400 | Invalid JSON or missing `device_id` |
| 401 | Unknown device or wrong token |
| 403 | Tracker suspended by the admin |

- `device_id` must be a registered tracker and the token must match its stored bcrypt hash. Both are checked before anything is written.
- Timestamps may end in `Z` or `+05:00` (older firmware); they are stored in UTC.
- A record older than the tracker's current position (offline backlog) is stored but does not move the tracker on the live map.
- A batch of buffered points can be sent as a JSON array or as `{"device_id":"…","records":[…]}`. It is processed in timestamp order and the reply counts `stored`, `duplicate` and `discarded`.
- `crash:true` creates a crash alert. Crossing a geofence edge creates a geofence alert.
- Every reply to the tracker carries `Content-Length` (the modem reads a chunked reply as 0 bytes).

---

## ⚡ Live Updates

1. The browser asks the dashboard for a ticket: `GET /api/realtime` returns the backend's socket address and a JWT valid for 2 minutes.
2. It opens `wss://<backend>/ws?token=<ticket>`.
3. As each record arrives, the backend pushes `position` and `alert` messages to the users allowed to see that tracker.
   - The admin receives everything.
   - An owner receives their own trackers' positions and alerts.
   - An invited viewer receives positions of shared vehicles only.
4. If the socket drops, the page reconnects with a new ticket and re-reads the data every 5 seconds in the meantime. The dashboard shows **Live** or **Updating every 5 s**.

A tracker counts as **online** when a record arrived in the last 90 seconds.

---

## 🔐 Authentication & Roles

| Role | Who | Can do |
|---|---|---|
| **Fleet Administrator** | `admin@fleettrack.com` (detected by email) | Everything: all trackers, devices, customers, geofences, firmware |
| **Vehicle Owner** | A customer with at least one tracker | Their own trackers: live map, trips, alerts, geofences, sharing |
| **Invited Viewer** | A user with no tracker of their own and a vehicle shared with them | Live location of the shared vehicle only |

- **Adding a device** (Devices → Add Device): the admin enters the tracker ID, device token, vehicle name and the customer's email.
  - If no account has that email, one is created and a generated password is shown once for the admin to hand over.
  - If the account exists, the device is added to it and the password is unchanged.
- **Passwords:** a user changes their own password in Settings (the current password is required). If a customer forgets it, the admin generates a new one on the Customers page. There is no reset from the login page.
- **Sharing** (Sharing page): the owner enters a viewer's email. A new viewer gets an account with a generated password, shown once to the owner.
- Every data API checks the login cookie and filters by ownership on the server.

---

## 🗄️ Database

The schema is managed with raw SQL on Neon. **Do NOT run `prisma migrate dev`.** Changes are in `prisma/sql/` and applied with:

```bash
node scripts/apply-sql.mjs prisma/sql/001_hardware_integration.sql
node scripts/apply-sql.mjs prisma/sql/002_project_brief.sql
```

| Table | Purpose |
|---|---|
| `users` | Admin, customers and viewers (`username`, `email`, `password_hash`, `company`) |
| `trackers` | One per device: owner, `secret_token_hash` (bcrypt hash of the device token), name, plate, status (`ACTIVE` / `SUSPENDED`), and the last known position |
| `location_points` | Raw GPS points of the current day (PostGIS point). Unique on `(tracker_id, recorded_at)` |
| `trip_history` | One row per tracker per finished day: start/end, distance, average and max speed, route (PostGIS LineString) |
| `alerts` | Crash and geofence alerts (coordinates, speed, time, PostGIS point), with resolved state |
| `geofences` | A polygon (PostGIS) for one tracker, with alert on entry/exit |
| `tracker_shares` | Which viewer may see which tracker's live location |
| `user_settings` | Theme, speed unit, which alert types to show |
| `firmware_releases` | OTA images (`.bin` stored as `bytea`, with size and SHA-256) |

The tables `User`, `Vehicle`, `TrackingDevice` and `UserSettings` (capitalised) are left over from the first prototype and are not used.

---

## 🧭 Trips

- One trip per tracker per local day (`TRIP_TIME_ZONE`, default `Asia/Karachi`).
- Only points at 3 km/h or more form the route, so a parked tracker's GPS jitter adds no distance. A day with no movement has no trip.
- Today's trip is built live from `location_points` and shown as **Active**.
- When the trips list is loaded, every finished day is rolled up into `trip_history` (distance from `ST_Length`) and its raw points are deleted. Trips and alerts are kept.

---

## 📦 Firmware OTA

Dashboard → **Firmware** (admin):

1. Set a higher `FW_VERSION` in the sketch and export `<sketch>.ino.bin`.
2. Upload the file with the same version. The upload is refused if the file is not an ESP32 app image, is over 1,200 KB, or does not contain the typed version.
3. Each tracker asks the backend (`/api/firmware/latest`) every minute and installs the highest version if it is newer than its own.

---

## 🌐 Dashboard API Routes (Vercel)

All need the login cookie; **A** = admin only.

```text
POST /api/auth/login | logout          GET /api/auth/me
GET  /api/realtime                      ticket + address for the live socket
GET  /api/live-location                 trackers with last position and status
GET  /api/trackers                      POST (A)
GET  /api/trackers/[trackerId]          PATCH (A)  DELETE (A)
GET  /api/trackers/[trackerId]/shares   POST   DELETE ?userId=N   (owner or admin)
GET  /api/trips    GET /api/trips?tripId=X          POST /api/trips/generate (A)
POST /api/road-route
GET  /api/alerts[?trackerId=X]          PATCH /api/alerts/[alertId]   (resolve)
GET  /api/geofences                     POST       PUT/DELETE /api/geofences/[id]   (owner or admin)
GET  /api/users (A)   POST (A)          DELETE /api/users/[id] (A)
POST /api/users/[id]/password (A)       generate a new password for a customer
GET  /api/settings    PUT               PUT /api/settings/password
GET  /api/firmware (A)   POST ?version=X (A)   DELETE ?version=X (A)
```

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

Put `BACKEND_URL=http://localhost:33430` in the root `.env` to get live pushes locally.

`scripts/simulate-tracker.mjs` sends records to the backend exactly as the firmware does:

```bash
# live drive, one record every 5 s, crash on record 5
node scripts/simulate-tracker.mjs --url http://localhost:33430 --device TRK-0001 --token <AUTH_TOKEN> --count 30 --crash 5

# replay an offline backlog from yesterday
node scripts/simulate-tracker.mjs --url http://localhost:33430 --device TRK-0001 --token <AUTH_TOKEN> --start 2026-10-02T06:00:00Z --interval 0 --count 100
```

Use the Render URL in `--url` to test the deployed backend.

---

## ⚠️ Known Limitations

- The tracker's payload has no battery, signal or firmware-version fields, so the dashboard does not show them.
- The modem does not verify the server's TLS certificate (`authmode 0` in the firmware).
- The firmware's update check and download carry the device token but no device ID, so the backend compares the token with each active tracker's hash (the result is then remembered in memory).
- On Render's free plan the service sleeps when idle; a tracker reporting every 5 seconds keeps it awake.

---

## 🛠️ Tech Stack

```text
Frontend   → Next.js (App Router), Tailwind, shadcn/ui        (Vercel)
Backend    → Node.js http + ws + pg (backend/tracker-api.js)  (Render)
Language   → TypeScript (dashboard), JavaScript (backend)
Database   → PostgreSQL + PostGIS (Neon)
ORM        → Prisma (+ raw SQL for PostGIS)
Auth       → JWT cookie; bcrypt for passwords and device tokens
Live       → WebSocket
Map        → Leaflet / React Leaflet, OpenStreetMap tiles
Routing    → OSRM
Tracker    → ESP32 + MPU6050 + SIMCom A7608E-H (see backend/README.md)
```

---

## 📜 License

MIT
