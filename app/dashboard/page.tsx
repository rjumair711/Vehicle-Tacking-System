'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { generateMockVehicles, generateMockAlerts, generateMockTrips } from '@/lib/mockData';
import { Vehicle, Alert as AlertType, Trip } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, AlertTriangle, Zap, Gauge } from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    setVehicles(generateMockVehicles());
    setAlerts(generateMockAlerts());
    setTrips(generateMockTrips());
  }, []);

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

  if (!user) return null;

  const onlineVehicles = vehicles.filter((v) => v.status !== 'offline').length;
  const activeAlerts = alerts.filter((a) => !a.isResolved).length;
  const activTrips = trips.filter((t) => t.status === 'active').length;
  const totalDistance = vehicles.reduce((sum, v) => sum + v.totalDistance, 0);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">Welcome back, {user.name}!</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Vehicles</CardTitle>
            <MapPin className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{onlineVehicles}</div>
            <p className="text-xs text-muted-foreground">of {vehicles.length} online</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Trips</CardTitle>
            <Zap className="h-4 w-4 text-chart-1" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{activTrips}</div>
            <p className="text-xs text-muted-foreground">in progress</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{activeAlerts}</div>
            <p className="text-xs text-muted-foreground">unresolved</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Distance</CardTitle>
            <Gauge className="h-4 w-4 text-chart-3" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{(totalDistance / 1000).toFixed(1)}</div>
            <p className="text-xs text-muted-foreground">thousand km</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Vehicles */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Fleet Status</CardTitle>
          <CardDescription>Real-time vehicle information</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {vehicles.slice(0, 4).map((vehicle) => (
              <div key={vehicle.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex-1">
                  <p className="font-medium text-foreground">{vehicle.name}</p>
                  <p className="text-xs text-muted-foreground">{vehicle.licensePlate}</p>
                </div>
                <div className="text-right">
                  <Badge
                    variant={
                      vehicle.status === 'online' ? 'default' : vehicle.status === 'offline' ? 'secondary' : 'outline'
                    }
                  >
                    {vehicle.status}
                  </Badge>
                  <p className="mt-1 text-xs text-muted-foreground">{vehicle.currentSpeed} km/h</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Alerts */}
      {activeAlerts > 0 && (
        <Card className="border-destructive/20 bg-card">
          <CardHeader>
            <CardTitle className="text-destructive">Recent Alerts</CardTitle>
            <CardDescription>{activeAlerts} unresolved alerts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts
                .filter((a) => !a.isResolved)
                .slice(0, 3)
                .map((alert) => (
                  <div key={alert.id} className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{alert.vehicleName}</p>
                      <p className="text-xs text-muted-foreground">{alert.message}</p>
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
