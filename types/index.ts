// Role-based access control
// ADMIN = fleet administrator, USER = vehicle owner,
// VIEWER = invited viewer (live location of shared vehicles only)
export type UserRole = 'ADMIN' | 'USER' | 'VIEWER';

export type SpeedUnit = 'km/h' | 'mph' | 'm/s';

// Logged-in user
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  company?: string | null;
  speedUnit?: SpeedUnit;
}

// Customer management
export interface CustomerTracker {
  trackerId: string;
  name?: string | null;
  licensePlate?: string | null;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  company?: string | null;
  trackers: CustomerTracker[];
}

// online   = a record arrived in the last 90 seconds
// offline  = nothing received recently (no power, no network or no GPS fix)
// suspended = suspended by the admin; its records are rejected
export type TrackerStatus = 'online' | 'offline' | 'suspended';

// GPS location
export interface Location {
  lat: number;
  lng: number;
  timestamp?: Date;
  speed?: number;
}

// Tracker / Device interface
// Device = Vehicle + GPS Tracker in current simplified design
export interface TrackingDevice {
  trackerId: string;

  name?: string;
  licensePlate?: string;

  status: TrackerStatus;

  // true when the vehicle belongs to someone else and is shared view-only
  shared?: boolean;

  customer?: {
    id: string;
    name: string;
    email: string;
  };

  lastSeen?: Date;
  createdAt?: Date;
  location?: Location;
}

// Trip history: one trip per tracker per day. Today's trip is 'active'.
export interface Trip {
  id: string;
  trackerId: string;
  trackerName?: string;
  licensePlate?: string;

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
export type AlertType = 'crash' | 'geofence';
export type AlertPriority = 'critical' | 'medium';

export interface Alert {
  id: string;

  trackerId: string;
  trackerName?: string;

  type: AlertType;
  priority: AlertPriority;
  message: string;

  timestamp: Date;
  location?: Location;
  speed?: number;

  isResolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

// Geofence: a polygon drawn on the map for one tracker
export interface Geofence {
  id: string;
  trackerId: string;
  trackerName?: string | null;
  name: string;
  description?: string;
  points: { lat: number; lng: number }[];
  color: string;
  alertOnEnter: boolean;
  alertOnExit: boolean;
  createdAt: Date;
}

// OTA firmware image
export interface FirmwareRelease {
  version: string;
  filename: string;
  size: number;
  sha256: string;
  uploadedAt: Date;
}
