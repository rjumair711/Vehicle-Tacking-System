# FleetTrack Pro – GPS Vehicle Tracking System

A professional GPS tracking and fleet management system built using Next.js, PostgreSQL, and PostGIS.

---

# 🚀 Current System Status

```text
Authentication        → ✅ Implemented (JWT + DB)
Customers            → ✅ Stored in database
Trackers             → ✅ Linked with users
GPS Ingestion        → ✅ Working (API + DB)
Live Location API    → ✅ Working
Trip System          → ✅ Working
Alerts (Crash)       → ✅ Working
Frontend             → ⚠️ Using mock data (for demo)
```

---

# 🧠 System Architecture

```text
Frontend (Next.js UI)
↓
Backend APIs (Next.js)
↓
Prisma ORM
↓
PostgreSQL + PostGIS
```

---

# 📁 Files Created / Updated (IMPORTANT)

## Database & Core Setup

```text
prisma/schema.prisma        → Defined models (User, Tracker, etc.)
.env                        → Database connection (Neon)
lib/prisma.ts              → Prisma client setup
```

---

## Backend API Routes

```text
app/api/trackers/route.ts
→ Create tracker (POST)
→ Fetch trackers (GET)

app/api/trackers/[trackerId]/route.ts
→ Get single tracker
→ Delete tracker

app/api/tracker-data/route.ts
→ Receives GPS data from tracker
→ Validates token
→ Stores location_points

app/api/live-location/route.ts
→ Returns latest location per tracker

app/api/trips/route.ts
→ Fetch trip history

app/api/trips/generate/route.ts
→ Generate daily trips using SQL

app/api/alerts/route.ts
→ Fetch crash alerts (crash = true)
```

---

## Frontend (Updated to Tracker Model)

```text
app/dashboard/devices/page.tsx
app/dashboard/map/page.tsx
app/dashboard/trips/page.tsx
app/dashboard/page.tsx
lib/mockData.ts
```

### Changes:

```text
Vehicle model removed
Tracker used everywhere
Device = Vehicle (merged)
```

---

# 🗄️ Database Design

## Tables

### Users

```text
user_id
username
email
password_hash
```

---

### Trackers

```text
tracker_id
user_id (FK)
secret_token_hash
name
license_plate
status
```

---

### Location Points (REAL-TIME)

```text
point_id
tracker_id
longitude
latitude
speed
crash
recorded_at
location (PostGIS Point)
```

---

### Trip History

```text
trip_id
tracker_id
trip_date
start_time
end_time
total_distance
average_speed
route (PostGIS LineString)
```

---

# ⚙️ Database Features

## PostGIS Functions

```text
ST_MakePoint → store GPS coordinates
ST_MakeLine  → generate trip route
```

---

## Indexes

```text
idx_location_tracker_time
idx_location_geom (GIST)
idx_trip_tracker_date
idx_trip_route (GIST)
```

---

## Trigger

```text
delete_processed_location_points()
```

Purpose:

```text
Deletes GPS data after trip creation
```

---

# 📡 GPS Data Flow

```text
Tracker Device
↓
POST /api/tracker-data
↓
Backend:
- validates token
- links tracker → user
- stores GPS points
↓
Daily:
- generates trip
- builds route
- deletes raw points
```

---

# 🧪 API Testing (Postman)

```text
POST /api/trackers
POST /api/tracker-data
GET  /api/live-location
GET  /api/trips
POST /api/trips/generate
GET  /api/alerts
```

---

# 🧠 Key Design Decisions

```text
No vehicle table (simplified)
Device = Vehicle
One trip per day per tracker
All data stored in DB (no memory usage)
PostGIS used for spatial operations
```

---

# ⚠️ Important Notes

```text
Frontend uses mock data (intentional)
Backend is fully functional and tested
Real tracker hardware not integrated yet
Alerts only support crash detection
```

---

# 🛠️ Tech Stack

```text
Frontend   → Next.js
Backend    → Next.js API Routes
Language   → TypeScript
Database   → PostgreSQL
Spatial DB → PostGIS
ORM        → Prisma
Auth       → JWT
Hashing    → bcrypt
```

---

# ⚙️ Setup

```bash
pnpm install
pnpm dev
npx prisma generate
```

⚠️ Important:

```text
Database schema is created using raw SQL (Neon)
Do NOT run prisma migrate dev
```

---

# 🧠 Final System Flow

```text
User
 ↓
Tracker
 ↓
Live GPS Data
 ↓
Database (PostGIS)
 ↓
Trip History + Alerts
```

---

# 📜 License

MIT
