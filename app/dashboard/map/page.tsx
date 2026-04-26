'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { generateMockTrackers } from '@/lib/mockData';
import { TrackingDevice } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Gauge, MapPin, Smartphone, Signal } from 'lucide-react';
import dynamic from 'next/dynamic';

const VehicleMap = dynamic(() => import('@/components/VehicleMap').then((m) => m.VehicleMap), {
  ssr: false,
});

export default function MapPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [trackers, setTrackers] = useState<TrackingDevice[]>([]);
  const [selectedTrackerId, setSelectedTrackerId] = useState<string>();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    setTrackers(generateMockTrackers());

    const interval = setInterval(() => {
      setTrackers(generateMockTrackers());
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const selectedTracker = trackers.find((tracker) => tracker.trackerId === selectedTrackerId);

  const mapTrackers = trackers.map((tracker) => ({
    id: tracker.trackerId,
    name: tracker.name ?? tracker.trackerId,
    licensePlate: tracker.licensePlate ?? 'N/A',
    status:
      tracker.status === 'active'
        ? 'online'
        : tracker.status === 'inactive'
        ? 'offline'
        : tracker.status,
    location: tracker.location ?? {
      lat: 0,
      lng: 0,
      timestamp: new Date(),
      speed: 0,
    },
    currentSpeed: tracker.location?.speed ?? 0,
    totalDistance: 0,
    fuelLevel: tracker.battery ?? 0,
    lastUpdate: tracker.lastPing ?? new Date(),
    deviceId: tracker.trackerId,
    companyId: tracker.customerId ?? '',
  }));

  if (isLoading || !user) return null;

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4 p-4 sm:p-6">
      {/* Map Section */}
      <div className="flex-1 min-h-96 lg:min-h-0">
        <Card className="border-border bg-card h-full">
          <CardHeader className="pb-3">
            <CardTitle>Live Map</CardTitle>
            <CardDescription>Real-time tracker locations</CardDescription>
          </CardHeader>
          <CardContent className="p-0 h-[60vh] lg:h-[75vh]">
            <VehicleMap
              vehicles={mapTrackers as any}
              selectedVehicleId={selectedTrackerId}
              onVehicleSelect={(id) => {
                setSelectedTrackerId(id);
                setIsSheetOpen(true);
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* Tracker List - Desktop */}
      <div className="hidden lg:block w-80">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Fleet Trackers</CardTitle>
            <CardDescription>{trackers.length} total trackers</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      {/* Mobile Tracker Details Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="bottom" className="h-[70vh] max-h-[70vh]">
          {selectedTracker ? (
            <>
              <SheetHeader>
                <SheetTitle>{selectedTracker.name ?? selectedTracker.trackerId}</SheetTitle>
                <SheetDescription>{selectedTracker.licensePlate ?? 'N/A'}</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4">
                <div className="grid gap-4">
                  <div className="rounded-lg border border-border bg-muted/50 p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Status</p>
                    <Badge variant="default">{selectedTracker.status.toUpperCase()}</Badge>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Gauge className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Speed</p>
                    </div>
                    <p className="text-2xl font-bold text-foreground">
                      {selectedTracker.location?.speed ?? 0} km/h
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Location</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedTracker.location
                        ? `${selectedTracker.location.lat.toFixed(4)}, ${selectedTracker.location.lng.toFixed(4)}`
                        : 'N/A'}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Smartphone className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Tracker ID</p>
                    </div>
                    <p className="text-foreground">{selectedTracker.trackerId}</p>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Signal className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Signal Strength</p>
                    </div>
                    <p className="text-foreground">
                      {selectedTracker.signalStrength ?? 'N/A'} dBm
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Battery</p>
                    <p className="text-xl font-bold text-foreground">
                      {selectedTracker.battery ?? 0}%
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">Select a tracker to view details</p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}