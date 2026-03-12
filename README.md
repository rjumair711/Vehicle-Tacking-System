# FleetTrack Pro - GPS Vehicle Tracking System

A professional, real-time GPS vehicle tracking and fleet management platform built with Next.js 16, React, TypeScript, and Tailwind CSS.

## Features

### Core Functionality
- **Live Map Tracking**: Real-time vehicle location visualization with interactive map
- **Trip Management**: Complete trip history with distance, duration, and speed analytics
- **Alert System**: Multi-priority alerts for speeding, geofence violations, offline status, and maintenance
- **Geofence Management**: Create and manage virtual boundaries with entry/exit alerts
- **Device Management**: Monitor GPS device status, battery levels, and signal strength
- **Role-Based Access Control**: 4 user roles (Admin, Manager, Operator, Viewer) with permission-based features

### User Experience
- **Responsive Design**: Mobile-first design with bottom navigation on phones, desktop sidebar on larger screens
- **Dark SaaS Theme**: Professional dark theme optimized for extended viewing
- **Interactive Maps**: Canvas-based vehicle mapping with zoom controls and vehicle selection
- **Real-Time Simulation**: Live vehicle simulation that continuously updates position, speed, and fuel data
- **Comprehensive Dashboards**: KPI cards, alerts, fleet status, and analytics

## Demo Accounts

### Admin Account
- **Email**: admin@fleettrack.com
- **Password**: admin123
- **Access**: Full system access, device management, all features

### Manager Account
- **Email**: manager@fleettrack.com
- **Password**: manager123
- **Access**: Team management, reporting, geofence management

### Operator Account
- **Email**: operator@fleettrack.com
- **Password**: operator123
- **Access**: Live tracking, trip history, alerts

### Viewer Account
- **Email**: viewer@fleettrack.com
- **Password**: viewer123
- **Access**: Read-only access to maps and reports

## Technology Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui components
- **Icons**: Lucide React
- **State Management**: React Hooks
- **Authentication**: Demo localStorage-based auth (for development)
- **Data**: Mock data generators for realistic simulation

## Project Structure

```
app/
├── page.tsx                 # Login page
├── dashboard/
│   ├── page.tsx            # Dashboard home
│   ├── map/                # Live map tracking
│   ├── trips/              # Trip history & analytics
│   ├── alerts/             # Alert management
│   ├── geofences/          # Geofence management
│   ├── devices/            # Device management (admin only)
│   └── settings/           # User settings
├── layout.tsx              # Root layout with auth provider
└── globals.css             # Global styles and theme

components/
├── AppShell.tsx            # Responsive app container
├── Header.tsx              # Top navigation header
├── Sidebar.tsx             # Desktop sidebar navigation
├── BottomNav.tsx           # Mobile bottom navigation
├── VehicleMap.tsx          # Interactive vehicle map
├── RoleGuard.tsx           # Role-based access control component

lib/
├── authContext.tsx         # Authentication context & hooks
├── mockData.ts             # Mock data generators
└── utils.ts                # Utility functions

hooks/
└── useVehicleSimulation.ts # Vehicle position/data simulation hook

types/
└── index.ts                # TypeScript type definitions
```

## Key Components

### AppShell
Responsive container that switches between desktop and mobile layouts based on screen size. Desktop shows a sidebar, mobile shows bottom navigation.

### VehicleMap
Canvas-based map component that displays vehicles in real-time. Supports:
- Vehicle position rendering with status indicators
- Zoom controls
- Vehicle selection and details panel
- Heading visualization
- Legend with status colors

### Authentication
Demo authentication system using localStorage. In production, would integrate with a real auth system (Supabase, Auth.js, etc.).

### Vehicle Simulation
Real-time vehicle position and data simulation that continuously updates:
- GPS coordinates with random movement
- Speed variations
- Heading/direction changes
- Fuel level decrements
- Distance accumulation
- Status changes

## Getting Started

### Installation

```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
pnpm install

# Run development server
pnpm dev
```

Visit `http://localhost:3000` to see the application.

### Demo Mode

The application comes pre-configured with demo data and mock vehicles that simulate real movement. Simply log in with any demo account to see live tracking in action.

## Configuration

### Theme
The application uses a professional dark theme by default. Theme colors are defined in:
- `app/globals.css` - CSS custom properties for colors
- `tailwind.config.ts` - Tailwind color configuration

### Mock Data
Mock data generators are in `lib/mockData.ts`. Modify these to customize:
- Vehicle information
- User accounts
- Geofence locations
- Tracking device data

### Simulation Settings
Adjust vehicle simulation behavior in `hooks/useVehicleSimulation.ts`:
- Update interval (currently 2 seconds)
- Movement distance
- Speed variation
- Status change probability

## Permissions & Roles

| Feature | Admin | Manager | Operator | Viewer |
|---------|-------|---------|----------|--------|
| Live Map | ✓ | ✓ | ✓ | ✓ |
| Trips | ✓ | ✓ | ✓ | ✓ |
| Alerts | ✓ | ✓ | ✓ | ✓ |
| Geofences | ✓ | ✓ | ✗ | ✗ |
| Devices | ✓ | ✗ | ✗ | ✗ |
| Settings | ✓ | ✓ | ✓ | ✓ |

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Performance Notes

- Vehicle simulation updates every 2 seconds
- Maps use canvas rendering for optimal performance
- Mock data is generated client-side for instant interaction
- No external API calls required for demo mode

## Future Enhancements

- Real GPS data integration with actual tracking API
- Database integration (Supabase, PostgreSQL)
- Advanced analytics and reporting
- Machine learning for anomaly detection
- Push notifications
- Multi-company/fleet support
- Custom report generation
- Driver behavior analytics
- Fuel consumption optimization
- Route planning and optimization

## Deployment

This application can be deployed to Vercel with zero configuration. Simply push to GitHub and connect your repository to Vercel.

```bash
# Deploy to Vercel
vercel deploy
```

## Support

For issues or questions, refer to the documentation or open an issue on the repository.

## License

MIT
