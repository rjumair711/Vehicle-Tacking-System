'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Geofence,
  Location,
  SpeedUnit,
  TrackingDevice,
  Trip,
} from '@/types';

// How often live pages re-read the server. The tracker reports every 5 s.
export const LIVE_REFRESH_MS = 5000;

export async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`) as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    error.code = data.code;
    throw error;
  }

  return data as T;
}

function pointFromGeoJson(value: unknown): Location | undefined {
  if (!value) return undefined;
  try {
    const point = typeof value === 'string' ? JSON.parse(value) : value;
    if (point?.type !== 'Point' || !Array.isArray(point.coordinates)) return undefined;
    return { lng: point.coordinates[0], lat: point.coordinates[1] };
  } catch {
    return undefined;
  }
}

function toTracker(t: any): TrackingDevice {
  return {
    trackerId: t.trackerId,
    name: t.name ?? undefined,
    licensePlate: t.licensePlate ?? undefined,
    status: t.status,
    shared: t.shared === true,
    customer: t.customer,
    lastSeen: t.lastSeen ? new Date(t.lastSeen) : undefined,
    createdAt: t.createdAt ? new Date(t.createdAt) : undefined,
    location: t.location
      ? {
          lat: t.location.lat,
          lng: t.location.lng,
          speed: t.location.speed,
          timestamp: t.location.timestamp ? new Date(t.location.timestamp) : undefined,
        }
      : undefined,
  };
}

function toTrip(t: any): Trip {
  const startTime = new Date(t.start_time);
  const endTime = t.end_time ? new Date(t.end_time) : undefined;

  return {
    id: t.trip_id,
    trackerId: t.tracker_id,
    trackerName: t.name ?? undefined,
    licensePlate: t.license_plate ?? undefined,
    startLocation: pointFromGeoJson(t.start_point),
    endLocation: pointFromGeoJson(t.end_point),
    startTime,
    endTime,
    distance: Number(t.total_distance ?? 0),
    duration: endTime ? Math.round((endTime.getTime() - startTime.getTime()) / 60000) : 0,
    averageSpeed: Number(t.average_speed ?? 0),
    maxSpeed: Number(t.max_speed ?? 0),
    status: t.status === 'active' ? 'active' : 'completed',
    routeGeoJson: t.route_geojson ?? undefined,
  };
}

function toAlert(a: any): Alert {
  return {
    id: a.id,
    trackerId: a.trackerId,
    trackerName: a.trackerName ?? a.trackerId,
    type: a.type,
    priority: a.type === 'crash' ? 'critical' : 'medium',
    message: a.message,
    timestamp: new Date(a.recordedAt),
    location:
      a.latitude !== null && a.longitude !== null
        ? { lat: a.latitude, lng: a.longitude }
        : undefined,
    speed: a.speed ?? undefined,
    isResolved: a.isResolved,
    resolvedAt: a.resolvedAt ? new Date(a.resolvedAt) : undefined,
    resolvedBy: a.resolvedBy ?? undefined,
  };
}

export async function fetchTrackers(): Promise<TrackingDevice[]> {
  const data = await apiFetch('/api/live-location');
  return (data.trackers ?? []).map(toTracker);
}

export async function fetchTrips(): Promise<Trip[]> {
  const data = await apiFetch('/api/trips');
  return (data.trips ?? []).map(toTrip);
}

export async function fetchTrip(tripId: string): Promise<Trip> {
  const data = await apiFetch(`/api/trips?tripId=${encodeURIComponent(tripId)}`);
  return toTrip(data.trip);
}

export async function fetchAlerts(): Promise<Alert[]> {
  const data = await apiFetch('/api/alerts');
  return (data.alerts ?? []).map(toAlert);
}

export async function fetchGeofences(): Promise<Geofence[]> {
  const data = await apiFetch('/api/geofences');
  return (data.geofences ?? []).map((g: any) => ({ ...g, createdAt: new Date(g.createdAt) }));
}

// Loads data on mount and, when intervalMs is given, keeps it fresh while
// the browser tab is visible.
export function useApiData<T>(loader: () => Promise<T>, initial: T, intervalMs?: number) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const refresh = useCallback(async () => {
    try {
      setData(await loaderRef.current());
      setError('');
    } catch (err: any) {
      // A lost session is handled by the auth redirect, not shown as an error.
      if (err?.status !== 401) setError(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!intervalMs) return;

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, setData, loading, error, refresh };
}

export function formatSpeed(kmh: number | undefined | null, unit: SpeedUnit = 'km/h'): string {
  const value = kmh ?? 0;
  if (unit === 'mph') return `${(value * 0.621371).toFixed(0)} mph`;
  if (unit === 'm/s') return `${(value / 3.6).toFixed(1)} m/s`;
  return `${value.toFixed(0)} km/h`;
}

export function formatLastSeen(date?: Date): string {
  if (!date) return 'Never';

  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return date.toLocaleString();
}
