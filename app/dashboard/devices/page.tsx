'use client';

import React, { useState } from 'react';
import AdminPageGuard from '@/components/AdminPageGuard';
import { apiFetch, formatLastSeen, formatSpeed } from '@/lib/api';
import { useLiveTrackers } from '@/lib/realtime';
import { useAuth } from '@/lib/authContext';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Smartphone,
  WifiOff,
  Clock,
  Plus,
  CarFront,
  MapPin,
  User,
  Copy,
} from 'lucide-react';

interface NewDeviceForm {
  name: string;
  trackerId: string;
  licensePlate: string;
  secretToken: string;
  customerEmail: string;
  customerName: string;
}

const initialFormState: NewDeviceForm = {
  name: '',
  trackerId: '',
  licensePlate: '',
  secretToken: '',
  customerEmail: '',
  customerName: '',
};

interface CreatedCustomer {
  name: string;
  email: string;
  created: boolean;
  password: string | null;
}

// 64 hex characters, the same shape as AUTH_TOKEN in the firmware.
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function DevicesPage() {
  const { user } = useAuth();
  const {
    data: devices,
    loading,
    error,
    refresh,
  } = useLiveTrackers();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isAddDeviceOpen, setIsAddDeviceOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const [newDevice, setNewDevice] = useState<NewDeviceForm>(initialFormState);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState('');

  const [createdCustomer, setCreatedCustomer] = useState<CreatedCustomer | null>(null);
  const [createdTrackerId, setCreatedTrackerId] = useState('');

  const selectedDevice = devices.find((d) => d.trackerId === selectedId) ?? null;

  const getStatusColor = (status: TrackingDevice['status']) => {
    switch (status) {
      case 'online':
        return 'default';
      case 'offline':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const onlineDevices = devices.filter((d) => d.status === 'online').length;
  const offlineDevices = devices.filter((d) => d.status === 'offline').length;

  const resetForm = () => {
    setNewDevice(initialFormState);
    setFormError('');
  };

  const setField = (field: keyof NewDeviceForm, value: string) =>
    setNewDevice((prev) => ({ ...prev, [field]: value }));

  const handleAddDevice = async () => {
    const payload = {
      name: newDevice.name.trim(),
      trackerId: newDevice.trackerId.trim(),
      licensePlate: newDevice.licensePlate.trim() || undefined,
      secretToken: newDevice.secretToken.trim(),
      customerEmail: newDevice.customerEmail.trim(),
      customerName: newDevice.customerName.trim() || undefined,
    };

    if (!payload.name || !payload.trackerId || !payload.secretToken || !payload.customerEmail) {
      setFormError('Vehicle name, Tracker ID, device token and customer email are required.');
      return;
    }

    try {
      setIsSaving(true);
      setFormError('');

      const data = await apiFetch('/api/trackers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setCreatedCustomer(data.customer);
      setCreatedTrackerId(payload.trackerId);
      setIsAddDeviceOpen(false);
      resetForm();
      refresh();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to add device');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = async (device: TrackingDevice) => {
    try {
      setActionError('');
      await apiFetch(`/api/trackers/${encodeURIComponent(device.trackerId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: device.status === 'suspended' ? 'ACTIVE' : 'SUSPENDED' }),
      });
      refresh();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to update device');
    }
  };

  const handleDeleteDevice = async () => {
    if (!selectedDevice) return;

    try {
      setActionError('');
      await apiFetch(`/api/trackers/${encodeURIComponent(selectedDevice.trackerId)}`, {
        method: 'DELETE',
      });
      setIsDeleteOpen(false);
      setIsSheetOpen(false);
      setSelectedId(null);
      refresh();
    } catch (err: any) {
      setIsDeleteOpen(false);
      setActionError(err?.message || 'Failed to delete device');
    }
  };

  return (
    <AdminPageGuard>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Tracking Devices</h1>
            <p className="mt-2 text-muted-foreground">
              Register trackers and assign them to customers
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

        {(error || actionError) && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error || actionError}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Smartphone className="h-4 w-4 text-primary" />
                Online
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground">{onlineDevices}</p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <WifiOff className="h-4 w-4 text-destructive" />
                Offline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">{offlineDevices}</p>
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

        {!loading && !error && devices.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No devices registered yet. Use Add Device to register your first tracker.
          </p>
        )}

        <div className="space-y-3">
          {devices.map((device) => (
            <button
              key={device.trackerId}
              onClick={() => {
                setSelectedId(device.trackerId);
                setIsSheetOpen(true);
              }}
              className="w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted"
            >
              <div className="grid gap-4 md:grid-cols-5">
                <div className="md:col-span-2">
                  <p className="font-semibold text-foreground">{device.name ?? device.trackerId}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tracker ID: {device.trackerId}
                  </p>
                  {device.licensePlate && (
                    <p className="text-xs text-muted-foreground">{device.licensePlate}</p>
                  )}
                </div>

                <div className="md:col-span-1">
                  <Badge variant={getStatusColor(device.status)}>
                    {device.status.toUpperCase()}
                  </Badge>
                </div>

                <div className="md:col-span-2 flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <User className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate text-sm text-foreground">
                      {device.customer?.name ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <span className="text-sm text-muted-foreground">
                      {formatLastSeen(device.lastSeen)}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Device details */}
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetContent
            side="bottom"
            className="mx-auto flex h-[85vh] max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl"
          >
            {selectedDevice ? (
              <>
                <SheetHeader className="shrink-0 px-5 pr-14">
                  <SheetTitle>{selectedDevice.name ?? selectedDevice.trackerId}</SheetTitle>
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
                          <Clock className="h-4 w-4" />
                          Last Seen
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-foreground">
                          {selectedDevice.lastSeen
                            ? selectedDevice.lastSeen.toLocaleString()
                            : 'No record received yet'}
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <MapPin className="h-4 w-4" />
                          Last Position
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {selectedDevice.location ? (
                          <div className="space-y-1">
                            <p className="font-mono text-sm text-foreground">
                              {selectedDevice.location.lat.toFixed(5)},{' '}
                              {selectedDevice.location.lng.toFixed(5)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {formatSpeed(selectedDevice.location.speed, user?.speedUnit)}
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No position received yet</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <CarFront className="h-4 w-4" />
                          Vehicle
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-medium text-foreground">
                          {selectedDevice.name ?? '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          License Plate: {selectedDevice.licensePlate ?? 'N/A'}
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <User className="h-4 w-4" />
                          Customer
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-medium text-foreground">
                          {selectedDevice.customer?.name ?? '—'}
                        </p>
                        <p className="break-all text-xs text-muted-foreground">
                          {selectedDevice.customer?.email}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="mt-6 flex gap-2 pb-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleToggleEnabled(selectedDevice)}
                    >
                      {selectedDevice.status === 'suspended' ? 'Reactivate Device' : 'Suspend Device'}
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={() => setIsDeleteOpen(true)}
                    >
                      Delete Device
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A suspended device stays registered, but the records it sends are rejected.
                  </p>
                </div>
              </>
            ) : null}
          </SheetContent>
        </Sheet>

        {/* Add device */}
        <Sheet
          open={isAddDeviceOpen}
          onOpenChange={(open) => {
            setIsAddDeviceOpen(open);
            if (!open) {
              resetForm();
            }
          }}
        >
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg px-6">
            <SheetHeader className="px-0">
              <SheetTitle>Add Device</SheetTitle>
              <SheetDescription>
                Register a GPS tracker and assign it to a customer
              </SheetDescription>
            </SheetHeader>

            <div className="mt-2 space-y-4 pb-8">
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
                  onChange={(e) => setField('name', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="licensePlate">License Plate (optional)</Label>
                <Input
                  id="licensePlate"
                  placeholder="e.g. ICT-007"
                  value={newDevice.licensePlate}
                  onChange={(e) => setField('licensePlate', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="trackerId">Tracker ID</Label>
                <Input
                  id="trackerId"
                  placeholder="e.g. TRK-0001"
                  value={newDevice.trackerId}
                  onChange={(e) => setField('trackerId', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Must equal DEVICE_ID in the tracker firmware.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="secretToken">Device Token</Label>
                <div className="flex gap-2">
                  <Input
                    id="secretToken"
                    className="font-mono text-xs"
                    placeholder="AUTH_TOKEN from the firmware"
                    autoComplete="off"
                    value={newDevice.secretToken}
                    onChange={(e) => setField('secretToken', e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setField('secretToken', generateToken())}
                  >
                    Generate
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Must equal AUTH_TOKEN in the tracker firmware. Paste the firmware&apos;s token,
                  or generate a new one and put it in the firmware before flashing. Only a hash
                  is stored, so copy it now.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="customerEmail">Customer Email</Label>
                <Input
                  id="customerEmail"
                  type="email"
                  placeholder="customer@example.com"
                  value={newDevice.customerEmail}
                  onChange={(e) => setField('customerEmail', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="customerName">Customer Name</Label>
                <Input
                  id="customerName"
                  placeholder="Needed only for a new customer"
                  value={newDevice.customerName}
                  onChange={(e) => setField('customerName', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  If no account exists for this email, one is created and its password is
                  shown to you once.
                </p>
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
                <Button className="flex-1" onClick={handleAddDevice} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Device'}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Result of adding a device: the customer's login */}
        <Dialog
          open={createdCustomer !== null}
          onOpenChange={(open) => {
            if (!open) setCreatedCustomer(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Device {createdTrackerId} registered</DialogTitle>
              <DialogDescription>
                {createdCustomer?.created
                  ? 'A customer account was created. Give these login details to the customer. The password is not shown again.'
                  : `The device was assigned to the existing customer ${createdCustomer?.name}. Their password is unchanged.`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Email</span>
                <span className="break-all font-mono">{createdCustomer?.email}</span>
              </div>
              {createdCustomer?.created && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Password</span>
                  <span className="font-mono">{createdCustomer.password}</span>
                </div>
              )}
            </div>

            <DialogFooter className="flex gap-2 sm:justify-end">
              {createdCustomer?.created && (
                <Button
                  variant="outline"
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      `Email: ${createdCustomer.email}\nPassword: ${createdCustomer.password}`
                    )
                  }
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
              )}
              <Button onClick={() => setCreatedCustomer(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Device</DialogTitle>
              <DialogDescription>
                Delete{' '}
                <span className="font-semibold text-foreground">
                  {selectedDevice?.name ?? selectedDevice?.trackerId}
                </span>
                ? Its positions, trips and alerts are deleted too. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:justify-end">
              <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteDevice}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminPageGuard>
  );
}
