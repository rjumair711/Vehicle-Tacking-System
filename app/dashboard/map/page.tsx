'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { generateMockVehicles } from '@/lib/mockData';
import { useVehicleSimulation } from '@/hooks/useVehicleSimulation';
import { Vehicle } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Fuel, Gauge, MapPin, Phone, Users } from 'lucide-react';
import dynamic from "next/dynamic";

const VehicleMap = dynamic(() => import("@/components/VehicleMap").then(m => m.VehicleMap), {
  ssr: false,
});

export default function MapPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [initialVehicles, setInitialVehicles] = useState<Vehicle[]>([]);
  const vehicles = useVehicleSimulation(initialVehicles, initialVehicles.length > 0);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    setInitialVehicles(generateMockVehicles());
  }, []);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  if (isLoading || !user) return null;

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4 p-4 sm:p-6">
      {/* Map Section */}
      <div className="flex-1 min-h-96 lg:min-h-0">
        <Card className="border-border bg-card h-full">
          <CardHeader className="pb-3">
            <CardTitle>Live Map</CardTitle>
            <CardDescription>Real-time vehicle locations</CardDescription>
          </CardHeader>
          <CardContent className="p-0 h-[60vh] lg:h-[75vh]">
            <VehicleMap
              vehicles={vehicles}
              selectedVehicleId={selectedVehicleId}
              onVehicleSelect={(id) => {
                setSelectedVehicleId(id);
                setIsSheetOpen(true);
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* Vehicle List - Desktop */}
      <div className="hidden lg:block w-80">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Fleet Vehicles</CardTitle>
            <CardDescription>{vehicles.length} total vehicles</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto">
              {vehicles.map((vehicle) => (
                <button
                  key={vehicle.id}
                  onClick={() => {
                    setSelectedVehicleId(vehicle.id);
                    setIsSheetOpen(false);
                  }}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    selectedVehicleId === vehicle.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{vehicle.name}</p>
                      <p className="text-xs text-muted-foreground">{vehicle.licensePlate}</p>
                    </div>
                    <Badge
                      variant={
                        vehicle.status === 'online'
                          ? 'default'
                          : vehicle.status === 'offline'
                          ? 'secondary'
                          : 'outline'
                      }
                      className="text-xs"
                    >
                      {vehicle.status}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{vehicle.currentSpeed} km/h</span>
                    <span>{vehicle.fuelLevel.toFixed(0)}% fuel</span>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Vehicle Details Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="bottom" className="h-[70vh] max-h-[70vh]">
          {selectedVehicle ? (
            <>
              <SheetHeader>
                <SheetTitle>{selectedVehicle.name}</SheetTitle>
                <SheetDescription>{selectedVehicle.licensePlate}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="grid gap-4">
                  <div className="rounded-lg border border-border bg-muted/50 p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Status</p>
                    <Badge variant="default">{selectedVehicle.status.toUpperCase()}</Badge>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Gauge className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Speed</p>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{selectedVehicle.currentSpeed} km/h</p>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Location</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedVehicle.location.lat.toFixed(4)}, {selectedVehicle.location.lng.toFixed(4)}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Fuel className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold text-foreground">Fuel Level</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${selectedVehicle.fuelLevel}%` }}
                        />
                      </div>
                      <p className="text-sm font-semibold text-foreground">{selectedVehicle.fuelLevel.toFixed(0)}%</p>
                    </div>
                  </div>

                  {selectedVehicle.driver && (
                    <div className="rounded-lg border border-border p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-4 w-4 text-primary" />
                        <p className="text-sm font-semibold text-foreground">Driver</p>
                      </div>
                      <p className="text-foreground">{selectedVehicle.driver}</p>
                    </div>
                  )}

                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Total Distance</p>
                    <p className="text-xl font-bold text-foreground">{(selectedVehicle.totalDistance / 1000).toFixed(1)} km</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">Select a vehicle to view details</p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
