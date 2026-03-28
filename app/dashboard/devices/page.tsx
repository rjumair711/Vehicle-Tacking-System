'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { generateMockDevices } from '@/lib/mockData';
import { TrackingDevice } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Smartphone, Signal, Battery, Zap, AlertCircle, Clock } from 'lucide-react';

export default function DevicesPage() {
  const router = useRouter();
  const { user, checkPermission, isLoading } = useAuth();
  const [devices, setDevices] = useState<TrackingDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<TrackingDevice | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }

    // Redirect if not admin
    if (!isLoading && user && !checkPermission('admin')) {
      router.push('/dashboard');
    }
  }, [isLoading, user, router, checkPermission]);

  useEffect(() => {
    setDevices(generateMockDevices());
  }, []);

  if (isLoading || !user) return null;

  const getStatusColor = (status: TrackingDevice['status']) => {
    switch (status) {
      case 'active':
        return 'default';
      case 'inactive':
        return 'secondary';
      case 'error':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getSignalQuality = (signal: number) => {
    if (signal === 0) return 'No Signal';
    if (signal > -70) return 'Excellent';
    if (signal > -80) return 'Good';
    if (signal > -90) return 'Fair';
    return 'Poor';
  };

  const activeDevices = devices.filter((d) => d.status === 'active').length;
  const inactiveDevices = devices.filter((d) => d.status === 'inactive').length;
  const errorDevices = devices.filter((d) => d.status === 'error').length;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Tracking Devices</h1>
        <p className="mt-2 text-muted-foreground">Manage GPS and IoT tracking devices</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-primary" />
              Active Devices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{activeDevices}</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">{errorDevices}</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total Devices</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{devices.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Devices List */}
      <div className="space-y-3">
        {devices.map((device) => (
          <button
            key={device.id}
            onClick={() => {
              setSelectedDevice(device);
              setIsSheetOpen(true);
            }}
            className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted transition-colors p-4"
          >
            <div className="grid gap-4 md:grid-cols-5">
              {/* Vehicle and Device Info */}
              <div className="md:col-span-2">
                <p className="font-semibold text-foreground">{device.vehicleName}</p>
                <p className="text-xs text-muted-foreground mt-1">IMEI: {device.imei}</p>
                {device.simCard && (
                  <p className="text-xs text-muted-foreground">{device.simCard}</p>
                )}
              </div>

              {/* Status */}
              <div className="md:col-span-1">
                <Badge variant={getStatusColor(device.status)}>
                  {device.status.toUpperCase()}
                </Badge>
              </div>

              {/* Battery and Signal */}
              <div className="md:col-span-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Battery className="h-4 w-4 text-primary" />
                  <span className="text-sm text-foreground">{device.battery}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Signal className="h-4 w-4 text-primary" />
                  <span className="text-sm text-muted-foreground">{getSignalQuality(device.signalStrength)}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Device Details Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent
          side="bottom"
          className="h-[85vh] max-h-[85vh] sm:max-w-2xl mx-auto flex flex-col overflow-hidden"
        >
          {selectedDevice ? (
            <>
              <SheetHeader className="px-5 pr-14 shrink-0">
                <SheetTitle>{selectedDevice.vehicleName}</SheetTitle>
                <SheetDescription>Device Information</SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-5 pb-8">
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {/* Device Status */}
                  <Card className="border-border bg-muted/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Device Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Badge variant={getStatusColor(selectedDevice.status)}>
                        {selectedDevice.status.toUpperCase()}
                      </Badge>
                    </CardContent>
                  </Card>

                  {/* IMEI */}
                  <Card className="border-border bg-muted/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">IMEI</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="font-mono text-sm text-foreground break-all">
                        {selectedDevice.imei}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Battery Level */}
                  <Card className="border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Battery className="h-4 w-4" />
                        Battery Level
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2">
                        <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${selectedDevice.battery > 50
                              ? 'bg-green-500'
                              : selectedDevice.battery > 20
                                ? 'bg-yellow-500'
                                : 'bg-destructive'
                              }`}
                            style={{ width: `${selectedDevice.battery}%` }}
                          />
                        </div>
                        <span className="text-lg font-bold text-foreground">
                          {selectedDevice.battery}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Signal Strength */}
                  <Card className="border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Signal className="h-4 w-4" />
                        Signal Strength
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <p className="font-mono text-sm text-foreground">
                          {selectedDevice.signalStrength} dBm
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {getSignalQuality(selectedDevice.signalStrength)}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Last Ping */}
                  <Card className="border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4" />
                        Last Ping
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-foreground">
                        {selectedDevice.lastPing.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>

                  {/* SIM Card */}
                  {selectedDevice.simCard && (
                    <Card className="border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">SIM Card</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-mono text-sm text-foreground break-all">
                          {selectedDevice.simCard}
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {/* Vehicle ID */}
                  <Card className="border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Vehicle ID</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="font-mono text-sm text-foreground break-all">
                        {selectedDevice.vehicleId}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <div className="mt-6 flex gap-2 pb-2">
                  <Button variant="outline" className="flex-1">
                    Test Connection
                  </Button>
                  <Button variant="outline" className="flex-1">
                    Edit Settings
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
