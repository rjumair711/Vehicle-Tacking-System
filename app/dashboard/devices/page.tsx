
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminPageGuard from '@/components/AdminPageGuard';
import { apiFetch, formatLastSeen, formatSpeed } from '@/lib/api';
import { useLiveTrackers } from '@/lib/realtime';
import { useAuth } from '@/lib/authContext';
import { Customer } from '@/types';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription,
  SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Smartphone, WifiOff, Plus, User, Clock,
  Eye, EyeOff, Search, ArrowRightLeft,
} from 'lucide-react';

type CustomerMode = 'existing' | 'new';

type NewDeviceForm = {
  name: string;
  trackerId: string;
  licensePlate: string;
  secretToken: string;
  customerMode: CustomerMode;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPassword: string;
  confirmPassword: string;
  customerCompany: string;
};

const emptyForm: NewDeviceForm = {
  name: '',
  trackerId: '',
  licensePlate: '',
  secretToken: '',
  customerMode: 'existing',
  customerId: '',
  customerName: '',
  customerEmail: '',
  customerPassword: '',
  confirmPassword: '',
  customerCompany: '',
};

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

export default function DevicesPage() {
  const { user } = useAuth();

  const {
    data: devices,
    loading,
    error,
    refresh,
  } = useLiveTrackers();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerError, setCustomerError] = useState('');
  const [form, setForm] = useState<NewDeviceForm>(emptyForm);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [destinationId, setDestinationId] = useState('');
  const [query, setQuery] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const selected =
    devices.find((device) => device.trackerId === selectedId) ?? null;

  const loadCustomers = useCallback(async () => {
    try {
      const data = await apiFetch('/api/users');
      setCustomers(data.users || []);
      setCustomerError('');
    } catch (err: any) {
      setCustomerError(err?.message || 'Could not load customers');
    }
  }, []);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const setField = <K extends keyof NewDeviceForm>(
    field: K,
    value: NewDeviceForm[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const openAdd = () => {
    setForm({
      ...emptyForm,
      customerMode: customers.length ? 'existing' : 'new',
    });
    setFormError('');
    setShowPassword(false);
    setAdding(true);
  };

  const handleCreate = async () => {
    setFormError('');

    if (
      !form.name.trim() ||
      !form.trackerId.trim() ||
      !form.secretToken.trim()
    ) {
      setFormError(
        'Vehicle name, tracker ID and device token are required.'
      );
      return;
    }

    if (form.customerMode === 'existing' && !form.customerId) {
      setFormError('Select an existing customer.');
      return;
    }

    if (form.customerMode === 'new') {
      if (!form.customerName.trim() || !form.customerEmail.trim()) {
        setFormError('Customer name and email are required.');
        return;
      }

      if (
        form.customerPassword.length < 8 ||
        form.customerPassword.length > 128
      ) {
        setFormError(
          'Customer password must be 8–128 characters.'
        );
        return;
      }

      if (form.customerPassword !== form.confirmPassword) {
        setFormError('Customer passwords do not match.');
        return;
      }
    }

    setSaving(true);

    try {
      const payload = {
        name: form.name.trim(),
        trackerId: form.trackerId.trim(),
        licensePlate: form.licensePlate.trim(),
        secretToken: form.secretToken.trim(),
        customerMode: form.customerMode,
        ...(form.customerMode === 'existing'
          ? {
              customerId: Number(form.customerId),
            }
          : {
              customerName: form.customerName.trim(),
              customerEmail: form.customerEmail.trim(),
              customerPassword: form.customerPassword,
              customerCompany: form.customerCompany.trim(),
            }),
      };

      await apiFetch('/api/trackers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setAdding(false);
      setForm(emptyForm);
      setNotice(
        'Device registered and assigned successfully. Customer login password was not changed.'
      );

      await loadCustomers();
      refresh();
    } catch (err: any) {
      setFormError(err?.message || 'Unable to register device');
    } finally {
      setSaving(false);
    }
  };

  const handleTransfer = async () => {
    if (!selected || !destinationId) return;

    setSaving(true);
    setActionError('');

    try {
      await apiFetch(
        `/api/trackers/${encodeURIComponent(selected.trackerId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: Number(destinationId),
          }),
        }
      );

      setTransferOpen(false);
      setDetailsOpen(false);
      setSelectedId(null);
      setDestinationId('');

      setNotice(
        'Tracker transferred. Existing location history is preserved; old sharing invitations are revoked.'
      );

      await loadCustomers();
      refresh();
    } catch (err: any) {
      setActionError(err?.message || 'Unable to transfer tracker');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async () => {
    if (!selected) return;

    setSaving(true);
    setActionError('');

    try {
      await apiFetch(
        `/api/trackers/${encodeURIComponent(selected.trackerId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status:
              selected.status === 'suspended'
                ? 'ACTIVE'
                : 'SUSPENDED',
          }),
        }
      );

      setNotice('Device status updated');
      refresh();
    } catch (err: any) {
      setActionError(err?.message || 'Could not update device');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;

    setSaving(true);
    setActionError('');

    try {
      await apiFetch(
        `/api/trackers/${encodeURIComponent(selected.trackerId)}`,
        { method: 'DELETE' }
      );

      setDeleteOpen(false);
      setDetailsOpen(false);
      setSelectedId(null);

      setNotice('Device deleted.');
      refresh();
      await loadCustomers();
    } catch (err: any) {
      setActionError(err?.message || 'Could not delete device');
    } finally {
      setSaving(false);
    }
  };

  const currentOwnerEmail =
    selected?.customer?.email?.toLowerCase();

  const transferTargets = customers.filter(
    (customer) =>
      customer.email.toLowerCase() !== currentOwnerEmail
  );

  const filtered = devices.filter((device) =>
    [
      device.name,
      device.trackerId,
      device.licensePlate,
      device.customer?.name,
      device.customer?.email,
    ].some((value) =>
      (value || '').toLowerCase().includes(query.toLowerCase())
    )
  );

  const online = devices.filter(
    (device) => device.status === 'online'
  ).length;

  const offline = devices.filter(
    (device) => device.status === 'offline'
  ).length;

  return (
    <AdminPageGuard>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">
              Tracking Devices
            </h1>
            <p className="text-muted-foreground">
              Register, monitor and transfer GPS devices
            </p>
          </div>

          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Device
          </Button>
        </div>

        {(error || actionError || customerError) && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
          >
            {error || actionError || customerError}
          </p>
        )}

        {notice && (
          <p role="status" className="rounded-md border p-3 text-sm">
            {notice}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Smartphone className="h-4 w-4" />
                Online
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">
              {online}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <WifiOff className="h-4 w-4" />
                Offline
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">
              {offline}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Total Devices
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">
              {devices.length}
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="Search devices"
            placeholder="Search vehicle, tracker ID or customer"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading && (
          <p className="text-sm text-muted-foreground">
            Loading devices...
          </p>
        )}

        {!loading && filtered.length === 0 && (
          <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            {query
              ? 'No matching devices.'
              : 'No registered devices. Choose Add Device to start.'}
          </p>
        )}

        {/* Devices list */}
        <div className="space-y-3">
          {filtered.map((device) => (
            <button
              type="button"
              key={device.trackerId}
              onClick={() => {
                setSelectedId(device.trackerId);
                setDetailsOpen(true);
                setActionError('');
              }}
              className="w-full rounded-xl border bg-card p-4 text-left transition hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {device.name || device.trackerId}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {device.trackerId} ·{' '}
                    {device.licensePlate || 'No plate provided'}
                  </p>
                </div>

                <Badge
                  variant={
                    device.status === 'online'
                      ? 'default'
                      : 'secondary'
                  }
                >
                  {device.status.toUpperCase()}
                </Badge>

                <p className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4" />
                  {device.customer?.name || 'Unassigned'}
                </p>

                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {formatLastSeen(device.lastSeen)}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Add device */}
        <Sheet
          open={adding}
          onOpenChange={(open) => {
            if (!saving) setAdding(open);
          }}
        >
          <SheetContent
            side="right"
            className="w-full overflow-y-auto px-6 sm:max-w-lg"
          >
            <SheetHeader className="px-0">
              <SheetTitle>Register Device</SheetTitle>
              <SheetDescription>
                Register hardware and assign it to an existing
                or new customer.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 pb-8 pt-5">
              {formError && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
                >
                  {formError}
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="vehicleName">
                  Vehicle Name
                </Label>
                <Input
                  id="vehicleName"
                  placeholder="e.g. CD 70"
                  value={form.name}
                  onChange={(e) =>
                    setField('name', e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="plate">
                  License Plate (optional)
                </Label>
                <Input
                  id="plate"
                  value={form.licensePlate}
                  onChange={(e) =>
                    setField('licensePlate', e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="trackerId">
                  Tracker ID
                </Label>
                <Input
                  id="trackerId"
                  placeholder="TRK-0001"
                  value={form.trackerId}
                  onChange={(e) =>
                    setField('trackerId', e.target.value)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Must match DEVICE_ID in the device firmware.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="token">
                  Device Token
                </Label>

                <div className="flex gap-2">
                  <Input
                    id="token"
                    className="min-w-0 font-mono text-xs"
                    autoComplete="off"
                    value={form.secretToken}
                    onChange={(e) =>
                      setField('secretToken', e.target.value)
                    }
                  />
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() =>
                      setField('secretToken', generateToken())
                    }
                  >
                    Generate
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Must match AUTH_TOKEN in the firmware.
                  Copy before saving: only its hash is stored.
                </p>
              </div>

              {/* Customer selection */}
              <div className="space-y-2 border-t pt-4">
                <Label>Assign to</Label>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={
                      form.customerMode === 'existing'
                        ? 'default'
                        : 'outline'
                    }
                    onClick={() =>
                      setField('customerMode', 'existing')
                    }
                  >
                    Existing Customer
                  </Button>

                  <Button
                    type="button"
                    variant={
                      form.customerMode === 'new'
                        ? 'default'
                        : 'outline'
                    }
                    onClick={() =>
                      setField('customerMode', 'new')
                    }
                  >
                    New Customer
                  </Button>
                </div>
              </div>

              {form.customerMode === 'existing' ? (
                <div className="space-y-2">
                  <Label htmlFor="existingCustomer">
                    Select Customer
                  </Label>

                  <select
                    id="existingCustomer"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.customerId}
                    onChange={(e) =>
                      setField('customerId', e.target.value)
                    }
                  >
                    <option value="">
                      Choose a customer
                    </option>

                    {customers.map((customer) => (
                      <option
                        value={customer.id}
                        key={customer.id}
                      >
                        {customer.name} — {customer.email}
                      </option>
                    ))}
                  </select>

                  {!customers.length && (
                    <p className="text-xs text-muted-foreground">
                      No customer accounts yet. Switch to
                      New Customer to create one.
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    The selected customer's password stays unchanged.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="newCustomerName">
                      Customer Name
                    </Label>
                    <Input
                      id="newCustomerName"
                      value={form.customerName}
                      onChange={(e) =>
                        setField('customerName', e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="newCustomerEmail">
                      Customer Email
                    </Label>
                    <Input
                      id="newCustomerEmail"
                      type="email"
                      autoComplete="off"
                      value={form.customerEmail}
                      onChange={(e) =>
                        setField('customerEmail', e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="newCustomerCompany">
                      Company (optional)
                    </Label>
                    <Input
                      id="newCustomerCompany"
                      value={form.customerCompany}
                      onChange={(e) =>
                        setField('customerCompany', e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="newPassword">
                      Initial Password
                    </Label>

                    <div className="relative">
                      <Input
                        id="newPassword"
                        className="pr-10"
                        autoComplete="new-password"
                        type={
                          showPassword ? 'text' : 'password'
                        }
                        value={form.customerPassword}
                        onChange={(e) =>
                          setField(
                            'customerPassword',
                            e.target.value
                          )
                        }
                      />

                      <button
                        type="button"
                        aria-label={
                          showPassword
                            ? 'Hide password'
                            : 'Show password'
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                        onClick={() =>
                          setShowPassword((value) => !value)
                        }
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="confirmPassword">
                      Confirm Password
                    </Label>
                    <Input
                      id="confirmPassword"
                      autoComplete="new-password"
                      type={
                        showPassword ? 'text' : 'password'
                      }
                      value={form.confirmPassword}
                      onChange={(e) =>
                        setField(
                          'confirmPassword',
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Set an initial password (8–128 characters).
                    The customer can change it in Settings.
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={saving}
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </Button>

                <Button
                  className="flex-1"
                  disabled={saving}
                  onClick={handleCreate}
                >
                  {saving
                    ? 'Saving...'
                    : 'Register & Assign'}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Device details */}
        <Sheet
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        >
          <SheetContent
            side="right"
            className="w-full overflow-y-auto px-6 sm:max-w-lg"
          >
            {selected && (
              <>
                <SheetHeader className="px-0">
                  <SheetTitle>
                    {selected.name || selected.trackerId}
                  </SheetTitle>
                  <SheetDescription>
                    Device details and customer ownership
                  </SheetDescription>
                </SheetHeader>

                <div className="space-y-4 py-6 text-sm">
                  <div className="rounded-lg border p-4">
                    <p className="text-muted-foreground">
                      Tracker ID
                    </p>
                    <p className="font-mono font-semibold">
                      {selected.trackerId}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border p-3">
                      <p className="text-muted-foreground">
                        Status
                      </p>
                      <p className="font-semibold capitalize">
                        {selected.status}
                      </p>
                    </div>

                    <div className="rounded-lg border p-3">
                      <p className="text-muted-foreground">
                        Plate
                      </p>
                      <p className="font-semibold">
                        {selected.licensePlate || 'Not set'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border p-4">
                    <p className="text-muted-foreground">
                      Assigned Customer
                    </p>
                    <p className="font-semibold">
                      {selected.customer?.name || 'Unassigned'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selected.customer?.email}
                    </p>
                  </div>

                  <div className="rounded-lg border p-4">
                    <p className="text-muted-foreground">
                      Last Seen
                    </p>
                    <p>{formatLastSeen(selected.lastSeen)}</p>

                    {selected.location && (
                      <p className="mt-2">
                        Location:{' '}
                        {selected.location.lat.toFixed(5)},{' '}
                        {selected.location.lng.toFixed(5)}
                        {' · '}
                        {formatSpeed(
                          selected.location.speed,
                          user?.speedUnit
                        )}
                      </p>
                    )}
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => {
                      setDestinationId('');
                      setTransferOpen(true);
                    }}
                  >
                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                    Transfer to Another Customer
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={handleStatus}
                    >
                      {selected.status === 'suspended'
                        ? 'Reactivate'
                        : 'Suspend'}
                    </Button>

                    <Button
                      variant="destructive"
                      disabled={saving}
                      onClick={() => setDeleteOpen(true)}
                    >
                      Delete Device
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Transfer changes ownership without deleting GPS
                    records. Deleting a device removes its data and
                    cannot be undone.
                  </p>
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>

        {/* Transfer confirmation */}
        <Dialog
          open={transferOpen}
          onOpenChange={(open) => {
            if (!saving) setTransferOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Transfer Tracker
              </DialogTitle>
              <DialogDescription>
                Move {selected?.name || selected?.trackerId}
                {' '}to a different customer. The old customer
                and their shared viewers will lose access;
                device history stays with the tracker.
              </DialogDescription>
            </DialogHeader>

            {actionError && (
              <p role="alert" className="text-sm text-destructive">
                {actionError}
              </p>
            )}

            <Label htmlFor="transferTarget">
              New Owner
            </Label>

            <select
              id="transferTarget"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={destinationId}
              onChange={(e) =>
                setDestinationId(e.target.value)
              }
            >
              <option value="">
                Choose customer
              </option>

              {transferTargets.map((customer) => (
                <option
                  key={customer.id}
                  value={customer.id}
                >
                  {customer.name} — {customer.email}
                </option>
              ))}
            </select>

            {!transferTargets.length && (
              <p className="text-xs text-muted-foreground">
                Create another customer first, then transfer
                the tracker.
              </p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setTransferOpen(false)}
              >
                Cancel
              </Button>

              <Button
                disabled={!destinationId || saving}
                onClick={handleTransfer}
              >
                {saving
                  ? 'Transferring...'
                  : 'Confirm Transfer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <Dialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (!saving) setDeleteOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Delete Device
              </DialogTitle>
              <DialogDescription>
                Delete {selected?.name || selected?.trackerId}?
                Location history, trips and alerts may be
                deleted. This cannot be undone. To change
                customers, use Transfer instead.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setDeleteOpen(false)}
              >
                Cancel
              </Button>

              <Button
                variant="destructive"
                disabled={saving}
                onClick={handleDelete}
              >
                {saving
                  ? 'Deleting...'
                  : 'Delete Device'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminPageGuard>
  );
}
