# K-Track / FleetTrack Pro – GPS Vehicle Tracking System

> **Documentation update: 8 November 2026**  
> Includes the **Trips v2 optimization/integration** discussed for this repository. The new trip code was added locally in VS Code, but a successful production build, Neon migration, OSRM road-match, and deployment have **not** been confirmed. Features below distinguish the established system from v2 changes still requiring verification.

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
Trips                 → ✅ One per tracker/day design; Trips v2 changes under local integration
Trip Route Map        → 🔧 v2 GPS map matching + separate historic map (not yet verified end-to-end)
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
TRIP_TIME_ZONE             Asia/Karachi (default)
NEXT_PUBLIC_TRIP_TIME_ZONE Asia/Karachi (Trips page date labels)
OSRM_MATCH_BASE_URL        base URL of your OSRM server, e.g. https://osrm.example.com (no /match/v1/driving)
ALLOW_PUBLIC_OSRM          true = use the free public OSRM demo server, also in production (see below)
OSRM_MAX_MATCH_COORDS      optional; points per /match request, must be <= osrm-routed --max-matching-size (default 85)
OSRM_MAX_MATCH_RADIUS      optional; metres, only if osrm-routed runs with --max-matching-radius
TRIP_MATCH_DEBUG           optional; "1" logs per-chunk OSRM status/code/confidence (never coordinates)
TRIP_ROLLUP_ON_READ        true (default); set false only with verified scheduled job
CRON_SECRET                optional, only if cron route is installed and scheduled
```

**Road matching and privacy:** the matcher uses `OSRM_MATCH_BASE_URL` when it points at your own server. Otherwise, it uses the public demo `router.project-osrm.org` **only** when `ALLOW_PUBLIC_OSRM=true`, or automatically in development. With neither set, production shows the recorded GPS trace in blue with a "road matching isn't configured" notice. `/api/road-route` follows the same rule and requires login.

`ALLOW_PUBLIC_OSRM=true` is free, but the demo server:
- is rate-limited (the app throttles to 1 request/s per server instance, sends an identifying User-Agent, and retries once after 2 s on 429/5xx),
- has no uptime guarantee,
- accepts only 10 points per match request and about a 40 m radius,
- **receives your trip coordinates** (a third-party, volunteer-run service).

Completed trips are matched once and stored in `trip_history.matched_route` / `matched_route_meta` (migration 005), and later views make no OSRM calls. The first view of a long trip can take up to ~50 s (`maxDuration = 60` on `/api/trips`). If time runs out, the map shows a `partial` result that isn't stored, and the next view continues from where it stopped. Today's active trip is cached in memory for 5 minutes and never stored. A trailing `/match/v1/driving` on the base URL is stripped.

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

Put it behind HTTPS (e.g. Caddy or nginx), then set `OSRM_MATCH_BASE_URL=https://<your-osrm-host>` on Vercel. Re-run the three build steps when you refresh the extract. The matched line of each completed trip is stored in `trip_history.matched_route` (migration `prisma/sql/005_trip_matched_route.sql`), so OSRM is called only once per trip.

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

# Trips v2 upgrade: apply only after backing up Neon and reviewing the SQL
node scripts/apply-sql.mjs prisma/sql/003_trip_route_points.sql
```

**Important:** The `003` file appearing in VS Code does **not** mean the migration has been applied to Neon. Confirm deployment of the migration before running the optimized `lib/trips.ts`, which expects the new archive table and flag.

| Table | Purpose |
|---|---|
| `users` | Admin, customers and viewers (`username`, `email`, `password_hash`, `company`) |
| `trackers` | One per device: owner, `secret_token_hash` (bcrypt hash of the device token), name, plate, status (`ACTIVE` / `SUSPENDED`), and the last known position |
| `location_points` | Raw GPS points of the current day (PostGIS point). Unique on `(tracker_id, recorded_at)` |
| `trip_history` | One row per tracker per finished day: start/end, distance, average and max speed, route (PostGIS LineString). Trips v2 adds `route_archive_v2` to mark safely recomputable records. |
| `trip_route_points` **(Trips v2)** | Per-point archive of moving GPS observations, retaining `(tracker_id, recorded_at)`, Pakistan-local trip date, speed and PostGIS location. Requires SQL migration `003`. |
| `alerts` | Crash and geofence alerts (coordinates, speed, time, PostGIS point), with resolved state |
| `geofences` | A polygon (PostGIS) for one tracker, with alert on entry/exit |
| `tracker_shares` | Which viewer may see which tracker's live location |
| `user_settings` | Theme, speed unit, which alert types to show |
| `firmware_releases` | OTA images (`.bin` stored as `bytea`, with size and SHA-256) |

The tables `User`, `Vehicle`, `TrackingDevice` and `UserSettings` (capitalised) are left over from the first prototype and are not used.

---

## 🧭 Trips – v2 optimization

### Product behavior

- **One trip per tracker per Pakistan-local calendar day**, rather than separate ignition-to-ignition rides. This is deliberate: a day can include multiple driving/parking periods in the same trip. `TRIP_TIME_ZONE` defaults to `Asia/Karachi`.
- **Today = Active** means today's aggregate contains at least two qualifying moving GPS points; it **does not** mean the vehicle is moving now.
- **Previous days = Completed**, stored in `trip_history`.
- The redesigned **Trip history** screen offers responsive vehicle cards, search by name/ID/plate, status filters, per-day grouping, distance, duration window, average/max moving speed, a recent-trips overview, loading/error/empty states, and a **View road path** action.
- Clicking a trip opens `/dashboard/map?tripId=<id>&trackerId=<id>`. The map switches to the **historical route viewer**, while the normal Live Map continues using the existing `VehicleMap` and WebSocket/polling workflow.

### How route reconstruction works

1. The ESP32 reports GPS data to `POST /api/tracker-data` through the Render backend.
2. Today's accepted moving observations remain in `location_points`; the `lib/trips.ts` live SQL query computes a daily record.
3. The rollup archives qualifying finished-day GPS observations to `trip_route_points` and aggregates them chronologically into `trip_history` (after SQL migration `003`). Archived timestamps allow recomputing v2 trips when offline/backlog data arrives later.
4. `GET /api/trips` returns a **list** without running costly OSRM matching.
5. When a trip opens, authenticated `GET /api/trips?tripId=...` requests its GPS samples and, **only when configured**, asks OSRM `/match/v1/driving` to align the trace to roads.
6. The dedicated `TripHistoryMap` renders `TripRouteLayer` with **green, road-matched polylines**, **dashed amber GPS-only/uncertain sections**, start/end markers, and automatic map fit.

**Do not request a new route between only the start and end coordinates.** Such a route may differ from the roads actually traveled. The historical map no longer needs to POST to `/api/road-route`; that endpoint may remain in the repository for other uses.

Map matching is an estimate, not proof of the exact path. Parallel roads, GPS drift, tunnels, sparse observations and missing recordings can make some segments uncertain. The system **must not** draw an invented continuous green route through an unrecorded gap. Legacy trips rolled up before timestamped GPS archival may have less accurate reconstruction.

### Core thresholds and metrics

| Rule | Value / meaning |
|---|---|
| Minimum moving speed | `3 km/h` (`MOVING_SPEED_KMH`) |
| Implausible speed exclusion | More than `220 km/h` (current code safeguard; not a physical guarantee) |
| Max gap eligible for distance accumulation | `180 seconds`; longer gaps are not counted as direct traveled distance |
| GPS map-matching radius | `35 m` per sample in the current matcher (can require tuning) |
| Matching input size | Up to 85 GPS samples per chunk, with overlap |
| Distance | Filtered GPS segment distance in kilometers; **not** OSRM road-route length |
| Average speed | Average of accepted moving speed samples; **not** time-weighted or whole-day average |
| Duration | Elapsed time from first to last moving GPS sample, including any parked time in between |
| Source coordinate order | GeoJSON/OSRM is `[longitude, latitude]`; Leaflet is `[latitude, longitude]` |

### Files and ownership

| Path | Responsibility |
|---|---|
| `app/dashboard/trips/page.tsx` | Redesigned Trips screen and View road path navigation |
| `app/api/trips/route.ts` | Cookie/session-authenticated trip list and single-trip endpoint; maps detailed trip fields for frontend |
| `lib/trips.ts` | Live trip SQL, completed-day archive/rollup, trip access filter, detailed trip retrieval |
| `lib/trip-road-match.ts` | Optional OSRM GPS map matching, segment splitting, caching, GPS fallback |
| `prisma/sql/003_trip_route_points.sql` | GPS observation archive and legacy-data protection flag |
| `app/dashboard/map/page.tsx` | Simple `<Suspense>` wrapper around the map client; **no major change required** |
| `hooks/mapPageClient.tsx` | Reads `tripId`, fetches detailed trip, switches between trip map and existing live `VehicleMap` |
| `components/TripHistoryMap.tsx` | Separate Leaflet historical map used only for trip view |
| `components/TripRouteLayer.tsx` | Draws matched and GPS-only path segments and start/end markers |
| `components/TripRouteLegend.tsx` | Explains route confidence/colors |
| `components/VehicleMap.tsx` | Existing live vehicle map; retained, not replaced |
| `app/api/cron/trips/route.ts` **(optional)** | Protected scheduled rollup; only if you add the optional cron handler |

> **Import paths matter:** In the current VS Code tree, the trip components are directly under `components/`, **not** `components/trips/`. Imports must use `@/components/TripRouteLayer`, `@/components/TripRouteLegend`, and `@/components/TripHistoryMap`.

### API response contract

**List:** `GET /api/trips` returns `{ "success": true, "trips": [...] }`. The existing `fetchTrips()` frontend mapping must continue to produce the `Trip` properties used by `app/dashboard/trips/page.tsx` (e.g. `id`, `trackerId`, `startTime`, `distance`). Do not assume database snake_case fields can be consumed directly without checking that mapper.

**Detail:** `GET /api/trips?tripId=<id>` returns `{ "success": true, "trip": { ... } }`, including the camelCase fields consumed by the updated `mapPageClient.tsx` and optionally snake_case compatibility fields:

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
    "status": "active",
    "roadSegments": [[[73.0689, 33.6286], [73.0701, 33.6292]]],
    "gpsSegments": [],
    "roadMatchStatus": "matched",
    "gpsPointsCount": 100
  }
}
```

**Example values only**, not real tracker data. `roadMatchStatus` is `matched`, `partial`, or `gps-only`. Route segments are arrays of polylines; multiple segments avoid joining disjoint observations. Keep ownership checks in `getTrip(session, tripId)` / `ownerFilter(session)` and never expose full trip traces without authentication.

### Trips v2 rollup and performance

- By default, `listTrips()` still calls `rollUpFinishedDays()` as it did previously. For larger fleets, this can make `GET /api/trips` expensive.
- Optional: add authenticated `GET /api/cron/trips` with `CRON_SECRET`, verify the job runs successfully, then use `TRIP_ROLLUP_ON_READ=false`. **Do not disable on-read rollup before cron is working**.
- To roll up shortly after Pakistan midnight, `19:05 UTC` corresponds to `00:05 PKT` the next day (UTC+05:00); use schedule `5 19 * * *` if supported by the hosting plan.
- Finished-day `trip_route_points` are intentionally retained. Set up a storage and retention plan before high-volume production operation.
- In-memory OSRM cache helps repeat requests on an instance, but may not be shared between multiple Vercel instances.

### Current integration / verification status

- The trip files and `TripHistoryMap.tsx` appear locally in the VS Code screenshot. **A green build and successfully rendered trip path have not been shown.**
- One actual TypeScript diagnostic was visible: `TS2882` for `import 'leaflet/dist/leaflet.css'` in `components/TripHistoryMap.tsx`. First confirm `leaflet` is installed (`npm ls leaflet react-leaflet`). Load Leaflet CSS once at the app root, preferably `app/layout.tsx`, and remove duplicate imports in route components; if TypeScript still reports an untyped stylesheet side-effect import, a root `global.d.ts` containing `declare module '*.css';` may be needed. Restart the TypeScript server and run `npm run build`.
- The editor's `min-h-[350px]`, `z-[1000]`, and `break-words` messages were Tailwind class normalization **suggestions**, not the actual TS error. Keep the classes if they work with the installed Tailwind version.
- The SQL migration `003`, environment variable `OSRM_MATCH_BASE_URL`, and production deployment have **not** been verified in the conversation. Without a working OSRM Match server, seeing an amber GPS line is expected.

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
GET  /api/trips                         list trips, no OSRM matching
GET  /api/trips?tripId=X                authorized selected trip + GPS matching fields
POST /api/trips/generate (A)           if present in your deployment
POST /api/road-route                   legacy/other route utility; NOT used for history view
GET  /api/cron/trips                    optional; only when handler installed and CRON_SECRET configured
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

### Trips v2 local setup

```bash
# 1. Install dependencies already listed by the repository
npm install
npm ls leaflet react-leaflet

# 2. Back up Neon, then apply the reviewed trip SQL migration ONCE
node scripts/apply-sql.mjs prisma/sql/003_trip_route_points.sql

# 3. Regenerate Prisma and validate TypeScript/Next.js
npx prisma generate
npm run build

# 4. Start the dashboard and test an authorized trip
npm run dev
```

Verify that `app/api/trips/route.ts` passes detailed `roadSegments` / `gpsSegments` into the frontend (or equivalent snake_case fields), and that `hooks/mapPageClient.tsx` no longer calls `/api/road-route` for historical journeys.

**Manual acceptance tests:** parked tracker (no jitter trip), current-day trip, completed day, multiple turns, 180+ second GPS gap, yesterday's delayed offline uploads, no OSRM server, denied access to another owner's tracker, Pakistan midnight boundary, and live-map behavior after returning from history.

For a successful route-matching test, use a **known real recorded trace** rather than merely a start/end pair. If the recorded points are missing or sparse, the exact roads cannot be proven.

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
- On Render's free plan the service may sleep when idle; regular telemetry can reduce idling, but wake behavior depends on the current hosting plan.
- Trips v2 road matching depends on sufficiently accurate GPS samples and a separately configured OSRM **Match** endpoint; it does not infer an exact road through missing data.
- Existing pre-v2 `trip_history` records may lack the original per-point timestamps; these cannot be fully reconstructed from an aggregated line alone.
- The Trip v2 archive stores potentially sensitive travel history; review access control, data retention, backups, and external OSRM privacy before production.
- The current build and migration status are unverified from the shared screenshots; do not treat this documentation update as deployment confirmation.

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
Routing    → OSRM Match (optional, configured for road-snapped GPS traces)
Tracker    → ESP32 + MPU6050 + SIMCom A7608E-H (see backend/README.md)
```

---

## 📜 License

MIT
