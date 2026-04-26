// Role-based access control
export type UserRole = 'admin' | 'user';

// User interface
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  company?: string;
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
  assignedTrackerIds: string[];
  createdAt: Date;
}

// Tracker status
export type TrackerStatus = 'active' | 'inactive' | 'error' | 'suspended';

// GPS location
export interface Location {
  lat: number;
  lng: number;
  timestamp: Date;
  speed?: number;
}

// Tracker / Device interface
// Device = Vehicle + GPS Tracker in current simplified design
export interface TrackingDevice {
  id: string;
  trackerId: string;

  name?: string;
  licensePlate?: string;

  status: TrackerStatus;
  battery?: number;
  signalStrength?: number;
  simCard?: string;

  customerId?: string;
  userId?: string;

  lastPing?: Date;
  location?: Location;
}

// Trip history
export interface Trip {
  id: string;
  trackerId: string;
  trackerName?: string;

  startLocation?: Location;
  endLocation?: Location;

  startTime: Date;
  endTime?: Date;

  distance: number;
  duration: number;
  averageSpeed: number;
  maxSpeed?: number;

  status: 'active' | 'completed';

  routeGeoJson?: unknown;
}

// Alert types
export type AlertType = 'crash' | 'speeding' | 'geofence' | 'offline';
export type AlertPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Alert {
  id: string;

  trackerId: string;
  trackerName?: string;

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

// Auth context
export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser?: () => Promise<void>;
  checkPermission: (requiredRole: UserRole) => boolean;
}