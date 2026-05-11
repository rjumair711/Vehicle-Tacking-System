'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { generateMockTrackers, generateMockTrips } from '@/lib/mockData';
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
import { Gauge, MapPin, Smartphone, Signal } from 'lucide-react';
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

type ApiTrip = {
  trip_id: string;
  tracker_id: string;
  name?: string;
  license_plate?: string;
  trip_date?: string;
  start_time: string;
  end_time?: string;
  total_distance: number;
  average_speed: number;
  route_geojson?: string | object | null;
};

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

function convertApiTripToTrip(apiTrip: ApiTrip): Trip {
  return {
    id: apiTrip.trip_id,
    trackerId: apiTrip.tracker_id,
    trackerName: apiTrip.name,

    startTime: new Date(apiTrip.start_time),
    endTime: apiTrip.end_time ? new Date(apiTrip.end_time) : undefined,

    distance: Number(apiTrip.total_distance ?? 0),
    duration: apiTrip.end_time
      ? Math.floor(
          (new Date(apiTrip.end_time).getTime() -
            new Date(apiTrip.start_time).getTime()) /
            60000
        )
      : 0,
    averageSpeed: Number(apiTrip.average_speed ?? 0),
    status: 'completed',

    routeGeoJson: apiTrip.route_geojson,
  };
}

export default function MapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();

  const tripIdFromUrl = searchParams.get('tripId');
  const trackerIdFromUrl = searchParams.get('trackerId');
  const isTripView = Boolean(tripIdFromUrl);

  const [trackers, setTrackers] = useState<TrackingDevice[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTrackerId, setSelectedTrackerId] = useState<string>();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [roadRoutePoints, setRoadRoutePoints] = useState<RoutePoint[]>([]);

  

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    setTrackers(generateMockTrackers());

    if (isTripView) return;

    const interval = setInterval(() => {
      setTrackers(generateMockTrackers());
    }, 5000);

    return () => clearInterval(interval);
  }, [isTripView]);

  useEffect(() => {
    if (trackerIdFromUrl) {
      setSelectedTrackerId(trackerIdFromUrl);
    }
  }, [trackerIdFromUrl]);

  useEffect(() => {
    async function loadTrips() {
      try {
        const response = await fetch('/api/trips');
        const data = await response.json();

        if (data.success && Array.isArray(data.trips)) {
          setTrips(data.trips.map(convertApiTripToTrip));
          return;
        }

        setTrips(generateMockTrips());
      } catch {
        setTrips(generateMockTrips());
      }
    }

    loadTrips();
  }, []);

  const selectedTrip = useMemo(() => {
    if (!tripIdFromUrl) return undefined;

    return trips.find((trip) => trip.id === tripIdFromUrl);
  }, [trips, tripIdFromUrl]);

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
                  : 'Loading selected trip route'
                : 'Real-time tracker locations'}
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0 h-[60vh] lg:h-[75vh]">
            <VehicleMap
              vehicles={isTripView ? [] : trackers}
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
                  : 'Loading trip'
                : `${trackers.length} total trackers`}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {isTripView && selectedTrip ? (
              <div className="rounded-lg border border-primary bg-primary/10 p-4">
                <p className="font-medium text-foreground">
                  {selectedTrip.trackerName ?? selectedTrip.trackerId}
                </p>

                <p className="text-xs text-muted-foreground mt-1">
                  Tracker ID: {selectedTrip.trackerId}
                </p>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Distance</span>
                    <span className="font-medium">
                      {selectedTrip.distance.toFixed(2)} km
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Average Speed</span>
                    <span className="font-medium">
                      {selectedTrip.averageSpeed.toFixed(1)} km/h
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Route Points</span>
                    <span className="font-medium">{routeToDisplay.length}</span>
                  </div>
                </div>

                <button
                  onClick={() => router.push('/dashboard/trips')}
                  className="mt-4 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                >
                  Back to Trips
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto">
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
                        </p>
                      </div>

                      <Badge
                        variant={
                          tracker.status === 'active'
                            ? 'default'
                            : tracker.status === 'inactive'
                              ? 'secondary'
                              : 'outline'
                        }
                        className="text-xs"
                      >
                        {tracker.status}
                      </Badge>
                    </div>

                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{tracker.location?.speed ?? 0} km/h</span>
                      <span>{tracker.battery ?? 0}% battery</span>
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

              <div className="mt-6 space-y-4">
                <div className="grid gap-4">
                  <div className="rounded-lg border border-border bg-muted/50 p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Status
                    </p>
                    <Badge variant="default">
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
                      {selectedTracker.location?.speed ?? 0} km/h
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
                            4
                          )}, ${selectedTracker.location.lng.toFixed(4)}`
                        : 'N/A'}
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

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Signal className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">
                        Signal Strength
                      </p>
                    </div>
                    <p className="text-foreground">
                      {selectedTracker.signalStrength ?? 'N/A'} dBm
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Battery
                    </p>
                    <p className="text-xl font-bold text-foreground">
                      {selectedTracker.battery ?? 0}%
                    </p>
                  </div>
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