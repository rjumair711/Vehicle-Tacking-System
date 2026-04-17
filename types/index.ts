// Role-based access control
export type UserRole = 'admin' | 'viewer';

// User interface
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  company: string;
  avatar?: string;
}

// Customer management
export interface Customer {
  id: string;
  name: string;
  email: string;
  company: string;
  phone?: string;
  status: 'active' | 'inactive';
  assignedVehicleIds: string[];
  createdAt: Date;
}

// Vehicle status
export type VehicleStatus = 'online' | 'offline' | 'idle' | 'moving' | 'parked';

// GPS location
export interface Location {
  lat: number;
  lng: number;
  timestamp: Date;
  accuracy?: number;
  heading?: number;
  speed?: number;
}

// Vehicle interface
export interface Vehicle {
  id: string;
  name: string;
  licensePlate: string;
  status: 'online' | 'offline' | 'idle' | 'moving' | 'parked';
  location: Location;
  currentSpeed: number;
  totalDistance: number;
  fuelLevel: number;
  lastUpdate: Date;
  driver?: string;
  deviceId: string;
  companyId: string;
  customerId?: string;
}

// Trip history
export interface Trip {
  id: string;
  vehicleId: string;
  vehicleName: string;
  startLocation: Location;
  endLocation?: Location;
  startTime: Date;
  endTime?: Date;
  distance: number;
  duration: number;
  averageSpeed: number;
  maxSpeed: number;
  status: 'active' | 'completed';
  driver?: string;
}

// Alert types
export type AlertType = 'speeding' | 'geofence' | 'idle' | 'maintenance' | 'offline';
export type AlertPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Alert {
  id: string;
  vehicleId: string;
  vehicleName: string;
  type: AlertType;
  priority: AlertPriority;
  message: string;
  timestamp: Date;
  location?: Location;
  isResolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

// Geofence
export interface Geofence {
  id: string;
  name: string;
  description?: string;
  center: Location;
  radius: number;
  type: 'inclusion' | 'exclusion';
  color: string;
  alertOnEnter: boolean;
  alertOnExit: boolean;
  companyId: string;
  createdAt: Date;
}

// Device management
export interface TrackingDevice {
  id: string;
  vehicleId: string;
  vehicleName: string;
  imei: string;
  status: 'active' | 'inactive' | 'error';
  battery: number;
  lastPing: Date;
  signalStrength: number;
  simCard?: string;
  customerId?: string;
}

// Auth context
export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser?: () => Promise<void>;
  checkPermission: (requiredRole: UserRole) => boolean;
}