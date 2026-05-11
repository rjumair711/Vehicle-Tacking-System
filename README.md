# FleetTrack Pro – GPS Vehicle Tracking System

A professional GPS tracking and fleet management system built using Next.js, PostgreSQL, and PostGIS.

---

# 🚀 Current System Status

```text
Authentication        → ✅ Implemented (JWT + DB)
Customers             → ✅ Stored in database
Trackers              → ✅ Linked with users
GPS Ingestion         → ✅ Working (API + DB)
Live Location API     → ✅ Working
Trip System           → ✅ Working
Trip Route Map        → ✅ Working
Start/End Markers     → ✅ Added
Road-based Routing    → ✅ Added using OSRM
Alerts (Crash)        → ✅ Working
Frontend              → ⚠️ Using mock data (for demo)
🧠 System Architecture
Frontend (Next.js UI)
↓
Backend APIs (Next.js)
↓
Prisma ORM
↓
PostgreSQL + PostGIS
📁 Files Created / Updated (IMPORTANT)
Database & Core Setup
prisma/schema.prisma        → Defined models (User, Tracker, etc.)
.env                        → Database connection (Neon)
lib/prisma.ts               → Prisma client setup
Backend API Routes
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
→ Returns trip route as GeoJSON

app/api/trips/generate/route.ts
→ Generate daily trips using SQL

app/api/road-route/route.ts
→ Converts rough trip coordinates into road-following route using OSRM

app/api/alerts/route.ts
→ Fetch crash alerts (crash = true)
Frontend Files
app/dashboard/devices/page.tsx
app/dashboard/map/page.tsx
app/dashboard/trips/page.tsx
app/dashboard/page.tsx
components/VehicleMap.tsx
lib/mockData.ts
Changes:
Vehicle model removed
Tracker used everywhere
Device = Vehicle (merged)
Trip click redirects to map section
Selected trip route displays on map
Start and End markers added
Live trackers hidden during trip route view
Mock tracker movement improved
🗄️ Database Design
Tables
Users
user_id
username
email
password_hash
Trackers
tracker_id
user_id (FK)
secret_token_hash
name
license_plate
status
Location Points (REAL-TIME)
point_id
tracker_id
longitude
latitude
speed
crash
recorded_at
location (PostGIS Point)
Trip History
trip_id
tracker_id
trip_date
start_time
end_time
total_distance
average_speed
route (PostGIS LineString)
⚙️ Database Features
PostGIS Functions
ST_MakePoint → store GPS coordinates
ST_MakeLine  → generate trip route
ST_AsGeoJSON → return route for frontend map
Indexes
idx_location_tracker_time
idx_location_geom (GIST)
idx_trip_tracker_date
idx_trip_route (GIST)
Trigger
delete_processed_location_points()

Purpose:

Deletes GPS data after trip creation
📡 GPS Data Flow
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
🗺️ Trip Route Map Flow
Trips Page
↓
Click any trip
↓
Redirect to Map Page
↓
Selected trip route is displayed
↓
Start and End markers are shown
↓
Route is adjusted to follow roads using OSRM
🧪 API Testing (Postman)
POST /api/trackers
POST /api/tracker-data
GET  /api/live-location
GET  /api/trips
POST /api/trips/generate
POST /api/road-route
GET  /api/alerts
🧠 Key Design Decisions
No vehicle table (simplified)
Device = Vehicle
Tracker used as main device entity
One trip per day per tracker
All data stored in DB (no memory usage)
PostGIS used for spatial operations
OSRM used for road-based trip route display
Frontend mock movement kept small for demo
⚠️ Important Notes
Frontend uses mock data (intentional)
Backend is fully functional and tested
Real tracker hardware not integrated yet
Alerts only support crash detection
Trip route view uses OSRM for road-following display
Live trackers are hidden when viewing a selected trip route
🛠️ Tech Stack
Frontend   → Next.js
Backend    → Next.js API Routes
Language   → TypeScript
Database   → PostgreSQL
Spatial DB → PostGIS
ORM        → Prisma
Auth       → JWT
Hashing    → bcrypt
Map        → Leaflet / React Leaflet
Routing    → OSRM
⚙️ Setup
pnpm install
pnpm dev
npx prisma generate

⚠️ Important:

Database schema is created using raw SQL (Neon)
Do NOT run prisma migrate dev
🧠 Final System Flow
User
 ↓
Tracker
 ↓
Live GPS Data
 ↓
Database (PostGIS)
 ↓
Trip History + Alerts
 ↓
Trip Route Map
📜 License

MIT