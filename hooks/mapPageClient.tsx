'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { fetchTrip, formatLastSeen, formatSpeed } from '@/lib/api';
import { useLiveTrackers } from '@/lib/realtime';
import { TrackingDevice, Trip } from '@/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Clock, Gauge, MapPin, Smartphone, User } from 'lucide-react';
import dynamic from 'next/dynamic';

const VehicleMap = dynamic(
  () => import('@/components/VehicleMap').then((m) => m.VehicleMap),
  {
    ssr: false,
  }
);

type RoutePoint = {
  lat: number;
  lng: number;
};

const NO_TRACKERS: TrackingDevice[] = [];

function convertGeoJsonToRoutePoints(routeGeoJson: unknown): RoutePoint[] {
  if (!routeGeoJson) return [];

  let parsedRoute: any = routeGeoJson;

  if (typeof routeGeoJson === 'string') {
    try {
      parsedRoute = JSON.parse(routeGeoJson);
    } catch {
      return [];
    }
  }

  if (parsedRoute?.type !== 'LineString') return [];
  if (!Array.isArray(parsedRoute.coordinates)) return [];

  return parsedRoute.coordinates
    .filter(
      (coordinate: unknown) =>
        Array.isArray(coordinate) &&
        coordinate.length >= 2 &&
        typeof coordinate[0] === 'number' &&
        typeof coordinate[1] === 'number'
    )
    .map((coordinate: number[]) => ({
      lng: coordinate[0],
      lat: coordinate[1],
    }));
}

export default function MapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();

  const tripIdFromUrl = searchParams.get('tripId');
  const trackerIdFromUrl = searchParams.get('trackerId');
  const isTripView = Boolean(tripIdFromUrl);

  // Live positions, pushed by the backend (paused while a trip is shown).
  const { data: trackers, error: trackersError, live } = useLiveTrackers(isTripView);

  const [selectedTrip, setSelectedTrip] = useState<Trip>();
  const [tripError, setTripError] = useState('');
  const [selectedTrackerId, setSelectedTrackerId] = useState<string>();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [roadRoutePoints, setRoadRoutePoints] = useState<RoutePoint[]>([]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (trackerIdFromUrl) {
      setSelectedTrackerId(trackerIdFromUrl);
    }
  }, [trackerIdFromUrl]);

  useEffect(() => {
    let cancelled = false;
    setSelectedTrip(undefined);
    setTripError('');

    if (!tripIdFromUrl) return;

    fetchTrip(tripIdFromUrl)
      .then((trip) => {
        if (!cancelled) setSelectedTrip(trip);
      })
      .catch((err) => {
        if (!cancelled) setTripError(err?.message || 'Failed to load trip');
      });

    return () => {
      cancelled = true;
    };
  }, [tripIdFromUrl]);

  const selectedTripRoute = useMemo(() => {
    if (!selectedTrip?.routeGeoJson) return [];

    return convertGeoJsonToRoutePoints(selectedTrip.routeGeoJson);
  }, [selectedTrip]);

  useEffect(() => {
    let cancelled = false;

    async function loadRoadRoute() {
      if (!isTripView || selectedTripRoute.length < 2) {
        setRoadRoutePoints([]);
        return;
      }

      try {
        const response = await fetch('/api/road-route', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            points: selectedTripRoute,
          }),
        });

        const data = await response.json();

        if (cancelled) return;

        if (data.success && Array.isArray(data.points)) {
          setRoadRoutePoints(data.points);
        } else {
          setRoadRoutePoints(selectedTripRoute);
        }
      } catch {
        if (!cancelled) {
          setRoadRoutePoints(selectedTripRoute);
        }
      }
    }

    loadRoadRoute();

    return () => {
      cancelled = true;
    };
  }, [isTripView, selectedTripRoute]);

  const routeToDisplay =
    roadRoutePoints.length > 1 ? roadRoutePoints : selectedTripRoute;

  const selectedTracker = trackers.find(
    (tracker) => tracker.trackerId === selectedTrackerId
  );

  if (isLoading || !user) return null;

  const statusVariant = (status: TrackingDevice['status']) =>
    status === 'online' ? 'default' : status === 'offline' ? 'secondary' : 'outline';

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4 p-4 sm:p-6">
      <div className="flex-1 min-h-96 lg:min-h-0">
        <Card className="border-border bg-card h-full">
          <CardHeader className="pb-3">
            <CardTitle>
              {isTripView ? 'Trip Route Map' : 'Live Map'}
            </CardTitle>
            <CardDescription>
              {isTripView
                ? selectedTrip
                  ? `${selectedTrip.trackerName ?? selectedTrip.trackerId} route`
                  : tripError || 'Loading selected trip route'
                : trackersError ||
                  (live ? 'Real-time tracker locations · live' : 'Tracker locations · updating every 5 s')}
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0 h-[60vh] lg:h-[75vh]">
            <VehicleMap
              vehicles={isTripView ? NO_TRACKERS : trackers}
              selectedVehicleId={selectedTrackerId}
              onVehicleSelect={(trackerId) => {
                setSelectedTrackerId(trackerId);
                setIsSheetOpen(true);
              }}
              routePoints={routeToDisplay}
            />
          </CardContent>
        </Card>
      </div>

      <div className="hidden lg:block w-80">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>
              {isTripView ? 'Selected Trip' : 'Fleet Trackers'}
            </CardTitle>

            <CardDescription>
              {isTripView
                ? selectedTrip
                  ? 'Trip route loaded on map'
                  : tripError || 'Loading trip'
                : `${trackers.length} total trackers`}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {isTripView ? (
              <div className="rounded-lg border border-primary bg-primary/10 p-4">
                {selectedTrip && (
                  <>
                    <p className="font-medium text-foreground">
                      {selectedTrip.trackerName ?? selectedTrip.trackerId}
                    </p>

                    <p className="text-xs text-muted-foreground mt-1">
                      Tracker ID: {selectedTrip.trackerId}
                    </p>

                    <div className="mt-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Date</span>
                        <span className="font-medium">
                          {selectedTrip.startTime.toLocaleDateString()}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Distance</span>
                        <span className="font-medium">
                          {selectedTrip.distance.toFixed(2)} km
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Average Speed</span>
                        <span className="font-medium">
                          {formatSpeed(selectedTrip.averageSpeed, user.speedUnit)}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Max Speed</span>
                        <span className="font-medium">
                          {formatSpeed(selectedTrip.maxSpeed, user.speedUnit)}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Recorded Points</span>
                        <span className="font-medium">{selectedTripRoute.length}</span>
                      </div>
                    </div>
                  </>
                )}

                <button
                  onClick={() => router.push('/dashboard/trips')}
                  className="mt-4 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                >
                  Back to Trips
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto">
                {trackers.length === 0 && (
                  <p className="text-sm text-muted-foreground">No trackers to show.</p>
                )}

                {trackers.map((tracker) => (
                  <button
                    key={tracker.trackerId}
                    onClick={() => {
                      setSelectedTrackerId(tracker.trackerId);
                      setIsSheetOpen(false);
                    }}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selectedTrackerId === tracker.trackerId
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-foreground">
                          {tracker.name ?? tracker.trackerId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tracker.licensePlate ?? 'N/A'}
                          {tracker.shared ? ` · shared by ${tracker.customer?.name}` : ''}
                        </p>
                      </div>

                      <Badge variant={statusVariant(tracker.status)} className="text-xs">
                        {tracker.status}
                      </Badge>
                    </div>

                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                      {tracker.location ? (
                        <>
                          <span>{formatSpeed(tracker.location.speed, user.speedUnit)}</span>
                          <span>Last seen {formatLastSeen(tracker.lastSeen)}</span>
                        </>
                      ) : (
                        <span>No position received yet</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="bottom" className="h-[70vh] max-h-[70vh]">
          {selectedTracker ? (
            <>
              <SheetHeader>
                <SheetTitle>
                  {selectedTracker.name ?? selectedTracker.trackerId}
                </SheetTitle>
                <SheetDescription>
                  {selectedTracker.licensePlate ?? 'N/A'}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4 overflow-y-auto px-4 pb-6">
                <div className="grid gap-4">
                  <div className="rounded-lg border border-border bg-muted/50 p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Status
                    </p>
                    <Badge variant={statusVariant(selectedTracker.status)}>
                      {selectedTracker.status.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Gauge className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">
                        Speed
                      </p>
                    </div>
                    <p className="text-2xl font-bold text-foreground">
                      {formatSpeed(selectedTracker.location?.speed, user.speedUnit)}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">
                        Location
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedTracker.location
                        ? `${selectedTracker.location.lat.toFixed(
                            5
                          )}, ${selectedTracker.location.lng.toFixed(5)}`
                        : 'No position received yet'}
                    </p>
                    {selectedTracker.location?.timestamp && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        GPS time: {selectedTracker.location.timestamp.toLocaleString()}
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">
                        Last Seen
                      </p>
                    </div>
                    <p className="text-foreground">
                      {formatLastSeen(selectedTracker.lastSeen)}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Smartphone className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">
                        Tracker ID
                      </p>
                    </div>
                    <p className="text-foreground">
                      {selectedTracker.trackerId}
                    </p>
                  </div>

                  {user.role === 'ADMIN' && selectedTracker.customer && (
                    <div className="rounded-lg border border-border p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="h-4 w-4 text-primary" />
                        <p className="text-sm font-semibold text-foreground">
                          Customer
                        </p>
                      </div>
                      <p className="text-foreground">{selectedTracker.customer.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedTracker.customer.email}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">
                Select a tracker to view details
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
