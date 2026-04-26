'use client';

import React, { useEffect, useState } from 'react';
import AdminPageGuard from '@/components/AdminPageGuard';
import { generateMockDevices } from '@/lib/mockData';
import { TrackingDevice } from '@/types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Smartphone,
  Signal,
  Battery,
  AlertCircle,
  Clock,
  Plus,
  Link as LinkIcon,
  CarFront,
} from 'lucide-react';

type DeviceStatus = TrackingDevice['status'];

interface NewDeviceForm {
  name: string;
  trackerId: string;
  licensePlate: string;
  simCard: string;
  battery: number;
  signalStrength: number;
  status: DeviceStatus;
}

const initialFormState: NewDeviceForm = {
  name: '',
  trackerId: '',
  licensePlate: '',
  simCard: '',
  battery: 100,
  signalStrength: -75,
  status: 'active',
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<TrackingDevice[]>([]);

  const [selectedDevice, setSelectedDevice] = useState<TrackingDevice | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const [isAddDeviceOpen, setIsAddDeviceOpen] = useState(false);
  const [isAttachVehicleOpen, setIsAttachVehicleOpen] = useState(false);

  const [newDevice, setNewDevice] = useState<NewDeviceForm>(initialFormState);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setDevices(generateMockDevices());
  }, []);

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
  const errorDevices = devices.filter((d) => d.status === 'error').length;

  const resetForm = () => {
    setNewDevice(initialFormState);
    setFormError('');
  };

  const handleAddDevice = () => {
    const trimmedName = newDevice.name.trim();
    const trimmedTrackerId = newDevice.trackerId.trim();
    const trimmedSimCard = newDevice.simCard.trim();
    const trimmedLicensePlate = newDevice.licensePlate.trim();
    

    if (!trimmedName || !trimmedTrackerId) {
      setFormError('Vehicle name and Tracker ID are required.');
      return;
    }

    const trackerIdExists = devices.some(
      (device) => device.trackerId.trim() === trimmedTrackerId
    );

    if (trackerIdExists) {
      setFormError('A device with this Tracker already exists.');
      return;
    }

    const deviceToAdd: TrackingDevice = {
      id: crypto.randomUUID(),
      trackerId: trimmedTrackerId,
      name: trimmedName,
      licensePlate: trimmedLicensePlate || undefined,
      simCard: trimmedSimCard || undefined,
      battery: Number(newDevice.battery),
      signalStrength: Number(newDevice.signalStrength),
      status: newDevice.status,
      lastPing: new Date(),
    };

    setDevices((prev) => [deviceToAdd, ...prev]);
    setIsAddDeviceOpen(false);
    resetForm();
  };

  return (
    <AdminPageGuard>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Tracking Devices</h1>
            <p className="mt-2 text-muted-foreground">
              Manage GPS and IoT tracking devices
            </p>
          </div>

          <Button
            onClick={() => {
              resetForm();
              setIsAddDeviceOpen(true);
            }}
            className="sm:w-auto"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Device
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
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
              <CardTitle className="flex items-center gap-2 text-sm">
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

        <div className="space-y-3">
          {devices.map((device) => (
            <button
              key={device.id}
              onClick={() => {
                setSelectedDevice(device);
                setIsSheetOpen(true);
              }}
              className="w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted"
            >
              <div className="grid gap-4 md:grid-cols-5">
                <div className="md:col-span-2">
                  <p className="font-semibold text-foreground">{device.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tracker ID: {device.trackerId}
                  </p>
                  {device.simCard && (
                    <p className="text-xs text-muted-foreground">{device.simCard}</p>
                  )}
                </div>

                <div className="md:col-span-1">
                  <Badge variant={getStatusColor(device.status)}>
                    {device.status.toUpperCase()}
                  </Badge>
                </div>

                <div className="md:col-span-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Battery className="h-4 w-4 text-primary" />
                    <span className="text-sm text-foreground">{device.battery}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Signal className="h-4 w-4 text-primary" />
                    <span className="text-sm text-muted-foreground">
                      {getSignalQuality(device.signalStrength ?? 0)}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetContent
            side="bottom"
            className="mx-auto flex h-[85vh] max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl"
          >
            {selectedDevice ? (
              <>
                <SheetHeader className="shrink-0 px-5 pr-14">
                  <SheetTitle>{selectedDevice.name}</SheetTitle>
                  <SheetDescription>Device Information</SheetDescription>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto px-5 pb-8">
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
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

                    <Card className="border-border bg-muted/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Tracker ID</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="break-all font-mono text-sm text-foreground">
                          {selectedDevice.trackerId}
                        </p>
                      </CardContent>
                    </Card>

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
                              className={`h-full ${selectedDevice.battery ?? 0 > 50
                                ? 'bg-green-500'
                                : selectedDevice.battery ?? 0 > 20
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
                            {selectedDevice.signalStrength ?? 0} dBm
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {getSignalQuality(selectedDevice.signalStrength ?? 0)}
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Clock className="h-4 w-4" />
                          Last Ping
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-foreground">
                          {selectedDevice.lastPing?.toLocaleString()}
                        </p>
                      </CardContent>
                    </Card>

                    {selectedDevice.simCard && (
                      <Card className="border-border">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">SIM Card</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="break-all font-mono text-sm text-foreground">
                            {selectedDevice.simCard}
                          </p>
                        </CardContent>
                      </Card>
                    )}

                    <Card className="border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <CarFront className="h-4 w-4" />
                          Attached Vehicle
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-medium text-foreground">
                          {selectedDevice.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          License Plate: {selectedDevice.licensePlate ?? 'N/A'}
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

                  <div className="mt-2 flex gap-2 pb-2">
                    <Button
                      className="flex-1"
                      onClick={() => setIsAttachVehicleOpen(true)}
                    >
                      <LinkIcon className="mr-2 h-4 w-4" />
                      Attach Vehicle
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </SheetContent>
        </Sheet>

        <Sheet
          open={isAddDeviceOpen}
          onOpenChange={(open) => {
            setIsAddDeviceOpen(open);
            if (!open) {
              resetForm();
            }
          }}
        >
          <SheetContent side="right" className="w-full sm:max-w-lg px-6">
            <SheetHeader>
              <SheetTitle>Add Device</SheetTitle>
              <SheetDescription>
                Register a new GPS tracking device
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              {formError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {formError}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="vehicleName">Vehicle Name</Label>
                <Input
                  id="vehicleName"
                  placeholder="e.g. Toyota Corolla - #007"
                  value={newDevice.name}
                  onChange={(e) =>
                    setNewDevice((prev) => ({
                      ...prev,
                      vehicleName: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="trackerId">Tracker ID</Label>
                <Input
                  id="trackerId"
                  placeholder="Enter Device Tracker ID"
                  value={newDevice.trackerId}
                  onChange={(e) =>
                    setNewDevice((prev) => ({
                      ...prev,
                      trackerId: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="simCard">SIM Card</Label>
                <Input
                  id="simCard"
                  placeholder="e.g. SIM007"
                  value={newDevice.simCard}
                  onChange={(e) =>
                    setNewDevice((prev) => ({
                      ...prev,
                      simCard: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="battery">Battery %</Label>
                  <Input
                    id="battery"
                    type="number"
                    min={0}
                    max={100}
                    value={newDevice.battery}
                    onChange={(e) =>
                      setNewDevice((prev) => ({
                        ...prev,
                        battery: Number(e.target.value),
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signalStrength">Signal (dBm)</Label>
                  <Input
                    id="signalStrength"
                    type="number"
                    value={newDevice.signalStrength}
                    onChange={(e) =>
                      setNewDevice((prev) => ({
                        ...prev,
                        signalStrength: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  value={newDevice.status}
                  onChange={(e) =>
                    setNewDevice((prev) => ({
                      ...prev,
                      status: e.target.value as DeviceStatus,
                    }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="error">Error</option>
                </select>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setIsAddDeviceOpen(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
                <Button className="flex-1" onClick={handleAddDevice}>
                  Save Device
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <Sheet
          open={isAttachVehicleOpen}
          onOpenChange={(open) => {
            setIsAttachVehicleOpen(open);
          }}
        >
          <SheetContent side="right" className="w-full sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>Attach Vehicle</SheetTitle>
              <SheetDescription>
                Select a vehicle for device {selectedDevice?.trackerId}
              </SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </div>
    </AdminPageGuard>
  );
}