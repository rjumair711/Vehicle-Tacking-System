import {
  User,
  Trip,
  Alert,
  Geofence,
  TrackingDevice,
  Customer,
} from '@/types';

// Mock users
export const mockUsers: Record<string, User> = {
  admin: {
    id: 'admin-001',
    email: 'admin@fleettrack.com',
    name: 'Alex Johnson',
    role: 'admin',
    company: 'FleetCo',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
  },
  user: {
    id: 'user-001',
    email: 'customer@fleettrack.com',
    name: 'Ahmed Raza',
    role: 'user',
    company: 'Alpha Logistics',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user',
  },
};

// Mock customers
export const generateMockCustomers = (): Customer[] => {
  return [
    {
      id: 'customer-001',
      name: 'Ahmed Raza',
      email: 'ahmed@alpha.com',
      company: 'Alpha Logistics',
      phone: '+92 300 1111111',
      status: 'active',
      assignedTrackerIds: ['TRK001', 'TRK002'],
      createdAt: new Date('2026-01-10'),
    },
    {
      id: 'customer-002',
      name: 'Sara Khan',
      email: 'sara@swiftcargo.com',
      company: 'Swift Cargo',
      phone: '+92 300 2222222',
      status: 'active',
      assignedTrackerIds: ['TRK003'],
      createdAt: new Date('2026-01-18'),
    },
  ];
};

// Central coordinates for Rawalpindi/Islamabad simulation
const centerLat = 33.6844;
const centerLng = 73.0479;
const radiusKm = 15;

function getRandomLocation() {
  const randomAngle = Math.random() * Math.PI * 2;
  const randomRadius = (Math.random() * radiusKm) / 111;

  return {
    lat: centerLat + randomRadius * Math.cos(randomAngle),
    lng: centerLng + randomRadius * Math.sin(randomAngle),
  };
}

// Generate mock trackers
export const generateMockTrackers = (): TrackingDevice[] => {
  return [
    {
      id: 'TRK001',
      trackerId: 'TRK001',
      name: 'Suzuki Cultus - #001',
      licensePlate: 'ICT-001',
      status: 'active',
      battery: 85,
      signalStrength: -65,
      simCard: 'SIM001',
      customerId: 'customer-001',
      lastPing: new Date(Date.now() - 30000),
      location: {
        ...getRandomLocation(),
        speed: 45,
        timestamp: new Date(),
      },
    },
    {
      id: 'TRK002',
      trackerId: 'TRK002',
      name: 'Toyota Corolla - #002',
      licensePlate: 'ICT-002',
      status: 'active',
      battery: 92,
      signalStrength: -72,
      simCard: 'SIM002',
      customerId: 'customer-001',
      lastPing: new Date(Date.now() - 45000),
      location: {
        ...getRandomLocation(),
        speed: 60,
        timestamp: new Date(),
      },
    },
    {
      id: 'TRK003',
      trackerId: 'TRK003',
      name: 'Honda City - #003',
      licensePlate: 'ICT-003',
      status: 'error',
      battery: 15,
      signalStrength: -95,
      simCard: 'SIM003',
      customerId: 'customer-002',
      lastPing: new Date(Date.now() - 3600000),
      location: {
        ...getRandomLocation(),
        speed: 0,
        timestamp: new Date(),
      },
    },
  ];
};

// Backward-compatible alias
// Use this temporarily if old pages still call generateMockDevices()
export const generateMockDevices = generateMockTrackers;

// Generate mock trips
export const generateMockTrips = (): Trip[] => {
  const trips: Trip[] = [];
  const trackerIds = ['TRK001', 'TRK002', 'TRK003'];
  const trackerNames = [
    'Suzuki Cultus - #001',
    'Toyota Corolla - #002',
    'Honda City - #003',
  ];

  for (let i = 0; i < 6; i++) {
    const trackerIndex = i % trackerIds.length;
    const startTime = new Date(Date.now() - (i + 1) * 3600000);
    const endTime = new Date(startTime.getTime() + Math.random() * 7200000);
    const distance = Math.floor(Math.random() * 120) + 10;
    const duration = endTime.getTime() - startTime.getTime();
    const avgSpeed = Math.floor((distance * 60) / (duration / 3600000));

    trips.push({
      id: `trip-${i + 1}`,
      trackerId: trackerIds[trackerIndex],
      trackerName: trackerNames[trackerIndex],
      startLocation: { ...getRandomLocation(), timestamp: startTime },
      endLocation: { ...getRandomLocation(), timestamp: endTime },
      startTime,
      endTime,
      distance,
      duration: Math.floor(duration / 60000),
      averageSpeed: avgSpeed,
      maxSpeed: avgSpeed + Math.floor(Math.random() * 30),
      status: 'completed',
    });
  }

  return trips;
};

// Generate mock alerts
export const generateMockAlerts = (): Alert[] => {
  const alerts: Alert[] = [];
  const alertTypes: Array<'crash' | 'speeding' | 'geofence' | 'offline'> = [
    'crash',
    'speeding',
    'geofence',
    'offline',
  ];

  const messages: Record<string, string> = {
    crash: 'Crash detected by tracker',
    speeding: 'Tracker reported high speed',
    geofence: 'Tracker entered restricted zone',
    offline: 'Tracker offline for extended period',
  };

  alertTypes.forEach((type, index) => {
    const trackerId = `TRK00${(index % 3) + 1}`;

    alerts.push({
      id: `alert-${index + 1}`,
      trackerId,
      trackerName: [
        'Suzuki Cultus - #001',
        'Toyota Corolla - #002',
        'Honda City - #003',
      ][index % 3],
      type,
      priority: ['critical', 'high', 'medium', 'low'][index] as any,
      message: messages[type],
      timestamp: new Date(Date.now() - Math.random() * 3600000),
      location: getRandomLocation() as any,
      isResolved: Math.random() > 0.5,
      resolvedAt:
        Math.random() > 0.5
          ? new Date(Date.now() - Math.random() * 1800000)
          : undefined,
      resolvedBy: Math.random() > 0.5 ? 'admin@fleettrack.com' : undefined,
    });
  });

  return alerts;
};

// Generate mock geofences
export const generateMockGeofences = (): Geofence[] => {
  return [
    {
      id: 'geo-1',
      name: 'Main Office Zone',
      description: 'Main office location',
      center: {
        lat: centerLat,
        lng: centerLng,
        timestamp: new Date(),
      },
      radius: 500,
      type: 'inclusion',
      color: '#3b82f6',
      alertOnEnter: false,
      alertOnExit: true,
      companyId: 'company-001',
      createdAt: new Date('2026-01-15'),
    },
    {
      id: 'geo-2',
      name: 'Restricted Area',
      center: {
        lat: 33.7000,
        lng: 73.0600,
        timestamp: new Date(),
      },
      radius: 300,
      type: 'exclusion',
      color: '#ef4444',
      alertOnEnter: true,
      alertOnExit: false,
      companyId: 'company-001',
      createdAt: new Date('2026-02-01'),
    },
  ];
};