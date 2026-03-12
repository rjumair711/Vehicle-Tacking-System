'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { generateMockTrips, generateMockVehicles } from '@/lib/mockData';
import { Trip, Vehicle } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Fuel, Gauge, MapPin, Clock, Navigation2 } from 'lucide-react';

export default function TripsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    setTrips(generateMockTrips());
    setVehicles(generateMockVehicles());
  }, []);

  if (isLoading || !user) return null;

  const formatTime = (date: Date) => date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const formatDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Trips</h1>
        <p className="mt-2 text-muted-foreground">Vehicle trip history and analytics</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="default">All Trips</Badge>
        <Badge variant="outline">Active Trips</Badge>
        <Badge variant="outline">Completed</Badge>
      </div>

      {/* Trips List */}
      <div className="space-y-3">
        {trips.map((trip) => (
          <button
            key={trip.id}
            onClick={() => {
              setSelectedTrip(trip);
              setIsSheetOpen(true);
            }}
            className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted transition-colors p-4"
          >
            <div className="grid gap-4 md:grid-cols-5">
              {/* Vehicle Info */}
              <div className="md:col-span-1">
                <p className="font-semibold text-foreground">{trip.vehicleName}</p>
                <p className="text-xs text-muted-foreground mt-1">{trip.vehicleId}</p>
              </div>

              {/* Time Info */}
              <div className="md:col-span-1">
                <div className="flex items-center gap-1 text-xs">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-foreground">{formatTime(trip.startTime)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{formatDate(trip.startTime)}</p>
              </div>

              {/* Distance & Duration */}
              <div className="md:col-span-1">
                <div className="flex items-center gap-1 text-sm">
                  <Navigation2 className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">{trip.distance} km</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{formatDuration(trip.duration)}</p>
              </div>

              {/* Speed Stats */}
              <div className="md:col-span-1">
                <div className="flex items-center gap-1 text-sm">
                  <Gauge className="h-4 w-4 text-primary" />
                  <span className="text-foreground">{trip.averageSpeed} km/h</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">avg</p>
              </div>

              {/* Status */}
              <div className="md:col-span-1 flex items-center justify-end">
                <Badge variant={trip.status === 'active' ? 'default' : 'secondary'}>
                  {trip.status.charAt(0).toUpperCase() + trip.status.slice(1)}
                </Badge>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Trip Details Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="bottom" className="h-[80vh] max-h-[80vh] sm:max-w-2xl mx-auto">
          {selectedTrip ? (
            <>
              <SheetHeader>
                <SheetTitle>{selectedTrip.vehicleName}</SheetTitle>
                <SheetDescription>Trip Details</SheetDescription>
              </SheetHeader>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {/* Basic Info */}
                <Card className="border-border bg-muted/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Trip Duration</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-foreground">{formatDuration(selectedTrip.duration)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatTime(selectedTrip.startTime)} - {selectedTrip.endTime ? formatTime(selectedTrip.endTime) : 'Ongoing'}
                    </p>
                  </CardContent>
                </Card>

                {/* Distance */}
                <Card className="border-border bg-muted/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Navigation2 className="h-4 w-4" />
                      Distance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-foreground">{selectedTrip.distance} km</p>
                  </CardContent>
                </Card>

                {/* Average Speed */}
                <Card className="border-border bg-muted/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Gauge className="h-4 w-4" />
                      Average Speed
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-foreground">{selectedTrip.averageSpeed} km/h</p>
                  </CardContent>
                </Card>

                {/* Max Speed */}
                <Card className="border-border bg-muted/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Max Speed</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-foreground">{selectedTrip.maxSpeed} km/h</p>
                  </CardContent>
                </Card>

                {/* Start Location */}
                <Card className="border-border md:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Start Location
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-foreground font-mono text-sm">
                      {selectedTrip.startLocation.lat.toFixed(4)}, {selectedTrip.startLocation.lng.toFixed(4)}
                    </p>
                  </CardContent>
                </Card>

                {/* End Location */}
                {selectedTrip.endLocation && (
                  <Card className="border-border md:col-span-2">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        End Location
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-foreground font-mono text-sm">
                        {selectedTrip.endLocation.lat.toFixed(4)}, {selectedTrip.endLocation.lng.toFixed(4)}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Driver */}
                {selectedTrip.driver && (
                  <Card className="border-border md:col-span-2">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Driver</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-foreground">{selectedTrip.driver}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
