'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import {
  LIVE_REFRESH_MS,
  fetchAlerts,
  fetchTrips,
  formatLastSeen,
  formatSpeed,
  useApiData,
} from '@/lib/api';
import { useLiveTrackers, useRealtime } from '@/lib/realtime';
import { Alert as AlertType, Trip } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, AlertTriangle, Zap, Gauge } from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const { data: trackers, error, live } = useLiveTrackers();
  const { data: alerts, refresh: refreshAlerts } = useApiData<AlertType[]>(
    fetchAlerts,
    [],
    live ? 30000 : LIVE_REFRESH_MS
  );

  // A new crash or geofence alert shows up at once.
  useRealtime((event) => {
    if (event.type === 'alert') refreshAlerts();
  });
  const { data: trips } = useApiData<Trip[]>(fetchTrips, [], 60000);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
    if (user?.role === 'VIEWER') {
      router.replace('/dashboard/map');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || user.role === 'VIEWER') return null;

  const onlineTrackers = trackers.filter((t) => t.status === 'online').length;
  const unresolvedAlerts = alerts.filter((a) => !a.isResolved);
  const activeTrips = trips.filter((t) => t.status === 'active').length;
  const totalDistance = trips.reduce((sum, trip) => sum + trip.distance, 0);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Welcome Section */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              live ? 'border-green-500/40 text-green-600' : 'border-border text-muted-foreground'
            }`}
            title={live ? 'Positions arrive the moment the tracker sends them' : 'Re-reading every 5 seconds'}
          >
            <span className={`h-2 w-2 rounded-full ${live ? 'bg-green-500' : 'bg-muted-foreground'}`} />
            {live ? 'Live' : 'Updating every 5 s'}
          </span>
        </div>
        <p className="mt-2 text-muted-foreground">Welcome back, {user.name}!</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Online Trackers</CardTitle>
            <MapPin className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{onlineTrackers}</div>
            <p className="text-xs text-muted-foreground">of {trackers.length} online</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Trips</CardTitle>
            <Zap className="h-4 w-4 text-chart-1" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{activeTrips}</div>
            <p className="text-xs text-muted-foreground">today</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{unresolvedAlerts.length}</div>
            <p className="text-xs text-muted-foreground">unresolved</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Distance</CardTitle>
            <Gauge className="h-4 w-4 text-chart-3" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{totalDistance.toFixed(1)}</div>
            <p className="text-xs text-muted-foreground">km across all trips</p>
          </CardContent>
        </Card>
      </div>

      {/* Fleet Status */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Fleet Status</CardTitle>
          <CardDescription>Real-time tracker information</CardDescription>
        </CardHeader>
        <CardContent>
          {trackers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {user.role === 'ADMIN'
                ? 'No trackers registered yet. Add one on the Devices page.'
                : 'No tracker is assigned to your account yet.'}
            </p>
          ) : (
            <div className="space-y-4">
              {trackers.map((tracker) => (
                <button
                  key={tracker.trackerId}
                  onClick={() => router.push(`/dashboard/map?trackerId=${encodeURIComponent(tracker.trackerId)}`)}
                  className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left hover:bg-muted"
                >
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{tracker.name ?? tracker.trackerId}</p>
                    <p className="text-xs text-muted-foreground">
                      {tracker.licensePlate ?? tracker.trackerId} · last seen {formatLastSeen(tracker.lastSeen)}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={
                        tracker.status === 'online' ? 'default' : tracker.status === 'offline' ? 'secondary' : 'outline'
                      }
                    >
                      {tracker.status}
                    </Badge>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tracker.status === 'online' ? formatSpeed(tracker.location?.speed, user.speedUnit) : '—'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Alerts */}
      {unresolvedAlerts.length > 0 && (
        <Card className="border-destructive/20 bg-card">
          <CardHeader>
            <CardTitle className="text-destructive">Recent Alerts</CardTitle>
            <CardDescription>{unresolvedAlerts.length} unresolved alerts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {unresolvedAlerts.slice(0, 3).map((alert) => (
                <div key={alert.id} className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{alert.trackerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {alert.message} · {alert.timestamp.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
