# FleetTrack Pro - GPS Vehicle Tracking System

A professional GPS vehicle tracking and fleet management platform built with **Next.js, TypeScript, Prisma, and PostgreSQL**.

---

## 🚀 Current System Status

This project is currently in a **hybrid stage**:

- ✅ Authentication → **REAL (Database + JWT)**
- ✅ Customers → **REAL (stored in DB)**
- ⚠️ Vehicles / Devices / Tracking → **Mock (simulation)**
- ⚠️ Assignments → UI-level (not yet persisted)

This allows full UI testing while backend integration is gradually implemented.

---

## 🔐 Authentication System (UPDATED)

### Features
- JWT-based authentication
- Role-based access control
- Secure password hashing (bcrypt)
- Cookie-based session handling

### Roles (Simplified)
- **ADMIN**
  - Full system control
  - Can create customers
  - Can manage devices
- **USER**
  - Customer account
  - Can log in (future: will see assigned data only)

---

## 👤 Customer Management (NEW)

### Admin can:
- Create customer accounts from dashboard
- Assign credentials (email + password)
- Store customers in database (Prisma)

### Customer can:
- Log in using assigned credentials

⚠️ Note:
- Vehicle/device assignment is currently **mock only**
- Dashboard filtering per customer will be added later

---

## 📊 Core Features

### Fleet Management
- Live vehicle tracking (simulated)
- Trip history and analytics
- Alert monitoring system
- Geofence management
- Device management

### Dashboard
- Active vehicles
- Active trips
- Alerts
- Total distance tracking

---

## 📡 Device Management

- View device status (Active / Error / Inactive)
- Battery monitoring
- Signal strength tracking
- Attach device to vehicle (mock phase)

---

## 🗺️ Live Tracking (Simulation)

- Real-time vehicle movement simulation
- Speed variation
- Fuel consumption
- Status changes (online/offline)

---

## 🧠 Architecture Overview


Frontend (Next.js)
↓
Auth API (JWT)
↓
Prisma ORM
↓
PostgreSQL Database


---

## 🧩 Data Flow (Current Phase)


Admin
↓
Creates Customer (DB)
↓
Customer Login (REAL)
↓
Dashboard (Mock Data)


---

## 🛠️ Tech Stack

- **Frontend**: Next.js (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Auth**: JWT + Cookies
- **Hashing**: bcryptjs

---

## 📁 Project Structure


app/
├── api/
│ ├── auth/
│ │ ├── login/
│ │ ├── logout/
│ │ └── me/
│ └── users/
│ └── route.ts # Create + Fetch users
│
├── dashboard/
│ ├── customers/ # Customer management (REAL DB)
│ ├── devices/ # Device management (mock)
│ ├── map/
│ ├── trips/
│ ├── alerts/
│ └── page.tsx
│
├── page.tsx # Login page

lib/
├── prisma.ts # Prisma client
├── authContext.tsx # Auth logic
├── mockData.ts # Simulation data

components/
├── RoleGuard.tsx
├── AdminPageGuard.tsx
├── Sidebar.tsx


---

## 🔑 How Authentication Works

### Login Flow


User → Login Form
↓
POST /api/auth/login
↓
Verify password (bcrypt)
↓
Generate JWT
↓
Store in cookie
↓
Access dashboard


---

## 🧪 Testing Credentials

### Admin

Email: admin@example.com

Password: admin123


### Customer (Created from dashboard)

Email: (entered by admin)
Password: 123456 (default for now)


---

## ⚠️ Current Limitations

- Vehicle assignment not saved in database
- Devices are mock-only
- Customer dashboard not filtered yet
- No real GPS tracking hardware integration

---

## 🚧 Next Development Phases

### Phase 1 (Completed ✅)
- Auth system (JWT)
- Role-based access
- Customer creation (DB)

### Phase 2 (Completed ✅)
- Device UI
- Vehicle assignment UI (mock)

### Phase 3 (Next 🔥)
- Save vehicle ownership in DB
- Link user → vehicle
- Filter dashboard per user

### Phase 4
- Save device → vehicle in DB
- Real ownership structure

### Phase 5
- Integrate real GPS tracker data

---

## 🧠 Final Target Architecture


User (DB)
↓
Vehicle (DB)
↓
Device (DB)
↓
Live GPS Data


---

## ⚙️ Setup Instructions

```bash
pnpm install
pnpm dev
🗄️ Database Setup
npx prisma migrate dev
npx prisma generate
npx prisma db seed
🚀 Deployment

Deploy easily on Vercel:

vercel deploy
💡 Notes
This project is designed for incremental backend integration
Mock data is used intentionally to simulate real-world behavior
Architecture is ready for scaling into production
📜 License

MIT


---

# ✅ What I updated (important)

- Removed old **localStorage auth**
- Removed **4 roles system**
- Added:
  - JWT auth
  - Prisma
  - PostgreSQL
  - Customer DB system
- Explained:
  - what is real vs mock
  - future roadmap
- Made it **professional + project-ready**

---

# 💬 If you want next upgrade

Next logical step is:

👉 **Save vehicle assignment in DB (Phase 3)**

Just say:
**"start phase 3"** and we’ll make your system fully relational 🚀

User-specific vehicle/device assignment and dashboard filtering will be implemented during real GPS tracker integration.