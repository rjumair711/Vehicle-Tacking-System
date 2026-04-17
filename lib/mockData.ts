import {
  User,
  Vehicle,
  Trip,
  Alert,
  Geofence,
  TrackingDevice,
  Customer,
} from '@/types';

// Mock users with different roles
export const mockUsers: Record<string, User> = {
  admin: {
    id: 'admin-001',
    email: 'admin@fleettrack.com',
    name: 'Alex Johnson',
    role: 'admin',
    company: 'FleetCo',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
  },
  viewer: {
    id: 'viewer-001',
    email: 'viewer@fleettrack.com',
    name: 'Lisa Anderson',
    role: 'viewer',
    company: 'FleetCo',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=viewer',
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
      assignedVehicleIds: ['vehicle-1', 'vehicle-2'],
      createdAt: new Date('2026-01-10'),
    },
    {
      id: 'customer-002',
      name: 'Sara Khan',
      email: 'sara@swiftcargo.com',
      company: 'Swift Cargo',
      phone: '+92 300 2222222',
      status: 'active',
      assignedVehicleIds: ['vehicle-3'],
      createdAt: new Date('2026-01-18'),
    },
    {
      id: 'customer-003',
      name: 'Usman Ali',
      email: 'usman@roadline.com',
      company: 'RoadLine Transport',
      phone: '+92 300 3333333',
      status: 'inactive',
      assignedVehicleIds: ['vehicle-4'],
      createdAt: new Date('2026-02-01'),
    },
  ];
};

// Central coordinates for simulation
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

// Generate mock vehicles
export const generateMockVehicles = (): Vehicle[] => {
  const vehicles: Vehicle[] = [];
  const names = [
    'Tesla Model S - #001',
    'Ford Transit - #002',
    'Volvo FH - #003',
    'Nissan Leaf - #004',
    'Mercedes Sprinter - #005',
    'Chevrolet Bolt - #006',
  ];
  const plates = ['FLT-001', 'FLT-002', 'FLT-003', 'FLT-004', 'FLT-005', 'FLT-006'];
  const statuses: Array<'online' | 'offline' | 'idle' | 'moving' | 'parked'> = [
    'online',
    'offline',
    'idle',
    'moving',
    'parked',
  ];

  const customerMap = [
    'customer-001',
    'customer-001',
    'customer-002',
    'customer-003',
    undefined,
    undefined,
  ];

  names.forEach((name, index) => {
    const location = getRandomLocation();

    vehicles.push({
      id: `vehicle-${index + 1}`,
      name,
      licensePlate: plates[index],
      status: statuses[index % statuses.length],
      location: {
        lat: location.lat,
        lng: location.lng,
        timestamp: new Date(),
        accuracy: 10,
        heading: Math.random() * 360,
        speed: Math.random() * 120,
      },
      currentSpeed: Math.floor(Math.random() * 120),
      totalDistance: Math.floor(Math.random() * 50000),
      fuelLevel: Math.random() * 100,
      lastUpdate: new Date(Date.now() - Math.random() * 60000),
      driver: [
        'John Driver',
        'Jane Operator',
        'Bob Smith',
        'Alice Cooper',
        'Charlie Brown',
        'David Lee',
      ][index],
      deviceId: `device-${index + 1}`,
      companyId: 'company-001',
      customerId: customerMap[index],
    });
  });

  return vehicles;
};

// Generate mock trips
export const generateMockTrips = (): Trip[] => {
  const trips: Trip[] = [];
  const vehicleIds = ['vehicle-1', 'vehicle-2', 'vehicle-3', 'vehicle-4', 'vehicle-5', 'vehicle-6'];
  const vehicleNames = [
    'Tesla Model S - #001',
    'Ford Transit - #002',
    'Volvo FH - #003',
    'Nissan Leaf - #004',
    'Mercedes Sprinter - #005',
    'Chevrolet Bolt - #006',
  ];

  for (let i = 0; i < 8; i++) {
    const vehicleIndex = i % vehicleIds.length;
    const startTime = new Date(Date.now() - (i + 1) * 3600000);
    const endTime = new Date(startTime.getTime() + Math.random() * 7200000);
    const distance = Math.floor(Math.random() * 200) + 10;
    const duration = endTime.getTime() - startTime.getTime();
    const avgSpeed = Math.floor((distance * 60) / (duration / 3600000));

    trips.push({
      id: `trip-${i + 1}`,
      vehicleId: vehicleIds[vehicleIndex],
      vehicleName: vehicleNames[vehicleIndex],
      startLocation: { ...getRandomLocation(), timestamp: startTime },
      endLocation: { ...getRandomLocation(), timestamp: endTime },
      startTime,
      endTime: i < 3 ? undefined : endTime,
      distance,
      duration: Math.floor(duration / 60000),
      averageSpeed: avgSpeed,
      maxSpeed: avgSpeed + Math.floor(Math.random() * 40),
      status: i < 3 ? 'active' : 'completed',
      driver: ['John Driver', 'Jane Operator', 'Bob Smith'][vehicleIndex % 3],
    });
  }

  return trips;
};

// Generate mock alerts
export const generateMockAlerts = (): Alert[] => {
  const alerts: Alert[] = [];
  const alertTypes: Array<'speeding' | 'geofence' | 'idle' | 'maintenance' | 'offline'> = [
    'speeding',
    'geofence',
    'idle',
    'maintenance',
    'offline',
  ];

  const messages: Record<string, string> = {
    speeding: 'Vehicle exceeding speed limit',
    geofence: 'Vehicle entered restricted zone',
    idle: 'Vehicle idle for extended period',
    maintenance: 'Scheduled maintenance overdue',
    offline: 'Vehicle offline for extended period',
  };

  alertTypes.forEach((type, index) => {
    alerts.push({
      id: `alert-${index + 1}`,
      vehicleId: `vehicle-${(index % 6) + 1}`,
      vehicleName: [
        'Tesla Model S - #001',
        'Ford Transit - #002',
        'Volvo FH - #003',
        'Nissan Leaf - #004',
        'Mercedes Sprinter - #005',
        'Chevrolet Bolt - #006',
      ][index % 6],
      type,
      priority: ['critical', 'high', 'medium', 'medium', 'low'][index] as any,
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
      name: 'Downtown Office',
      description: 'Main office location',
      center: {
        lat: 37.7749,
        lng: -122.4194,
        timestamp: new Date(),
      },
      radius: 500,
      type: 'inclusion',
      color: '#3b82f6',
      alertOnEnter: false,
      alertOnExit: true,
      companyId: 'company-001',
      createdAt: new Date('2024-01-15'),
    },
    {
      id: 'geo-2',
      name: 'Restricted Area',
      center: {
        lat: 37.785,
        lng: -122.41,
        timestamp: new Date(),
      },
      radius: 300,
      type: 'exclusion',
      color: '#ef4444',
      alertOnEnter: true,
      alertOnExit: false,
      companyId: 'company-001',
      createdAt: new Date('2024-02-01'),
    },
    {
      id: 'geo-3',
      name: 'Warehouse Zone',
      center: {
        lat: 37.77,
        lng: -122.42,
        timestamp: new Date(),
      },
      radius: 400,
      type: 'inclusion',
      color: '#8b5cf6',
      alertOnEnter: true,
      alertOnExit: true,
      companyId: 'company-001',
      createdAt: new Date('2024-01-20'),
    },
  ];
};

// Generate mock devices
export const generateMockDevices = (): TrackingDevice[] => {
  return [
    {
      id: 'device-1',
      vehicleId: 'vehicle-1',
      vehicleName: 'Tesla Model S - #001',
      imei: '861358049035225',
      status: 'active',
      battery: 85,
      lastPing: new Date(Date.now() - 30000),
      signalStrength: -65,
      simCard: 'SIM001',
      customerId: 'customer-001',
    },
    {
      id: 'device-2',
      vehicleId: 'vehicle-2',
      vehicleName: 'Ford Transit - #002',
      imei: '861358049035226',
      status: 'active',
      battery: 92,
      lastPing: new Date(Date.now() - 45000),
      signalStrength: -72,
      simCard: 'SIM002',
      customerId: 'customer-001',
    },
    {
      id: 'device-3',
      vehicleId: 'vehicle-3',
      vehicleName: 'Volvo FH - #003',
      imei: '861358049035227',
      status: 'error',
      battery: 15,
      lastPing: new Date(Date.now() - 3600000),
      signalStrength: -95,
      simCard: 'SIM003',
      customerId: 'customer-002',
    },
    {
      id: 'device-4',
      vehicleId: 'vehicle-4',
      vehicleName: 'Nissan Leaf - #004',
      imei: '861358049035228',
      status: 'active',
      battery: 78,
      lastPing: new Date(Date.now() - 60000),
      signalStrength: -60,
      simCard: 'SIM004',
      customerId: 'customer-003',
    },
    {
      id: 'device-5',
      vehicleId: 'vehicle-5',
      vehicleName: 'Mercedes Sprinter - #005',
      imei: '861358049035229',
      status: 'inactive',
      battery: 0,
      lastPing: new Date(Date.now() - 86400000),
      signalStrength: 0,
      simCard: 'SIM005',
    },
    {
      id: 'device-6',
      vehicleId: 'vehicle-6',
      vehicleName: 'Chevrolet Bolt - #006',
      imei: '861358049035230',
      status: 'active',
      battery: 88,
      lastPing: new Date(Date.now() - 120000),
      signalStrength: -68,
      simCard: 'SIM006',
    },
  ];
};