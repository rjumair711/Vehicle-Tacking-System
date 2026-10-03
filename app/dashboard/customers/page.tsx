'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminPageGuard from '@/components/AdminPageGuard';
import { apiFetch } from '@/lib/api';
import { Customer, CustomerTracker } from '@/types';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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

import { UserPlus, Building2, Mail, Copy } from 'lucide-react';

interface NewCustomerForm {
  name: string;
  email: string;
  company: string;
  password: string;
}

const initialForm: NewCustomerForm = {
  name: '',
  email: '',
  company: '',
  password: '',
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadError, setLoadError] = useState('');

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const [form, setForm] = useState<NewCustomerForm>(initialForm);
  const [formError, setFormError] = useState('');

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  const [customerToReset, setCustomerToReset] = useState<Customer | null>(null);
  const [newLogin, setNewLogin] = useState<{ email: string; password: string } | null>(null);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await apiFetch('/api/users');
      setCustomers(data.users || []);
      setLoadError('');
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to fetch customers');
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const totalTrackers = customers.reduce(
    (sum, customer) => sum + customer.trackers.length,
    0
  );
  const customersWithTrackers = customers.filter((c) => c.trackers.length > 0).length;

  const resetForm = () => {
    setForm(initialForm);
    setFormError('');
  };

  const handleAddCustomer = async () => {
    try {
      setFormError('');

      if (!form.name || !form.email || !form.password) {
        setFormError('Name, email and password are required');
        return;
      }

      if (form.password.length < 6) {
        setFormError('Password must be at least 6 characters');
        return;
      }

      await apiFetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: form.name,
          email: form.email,
          password: form.password,
          company: form.company || undefined,
        }),
      });

      setIsAddOpen(false);
      resetForm();
      loadCustomers();
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  // Trackers that belong to other customers and can be moved to this one.
  const getOtherTrackers = (customer: Customer | null) => {
    if (!customer) return [];

    return customers
      .filter((other) => other.id !== customer.id)
      .flatMap((other) =>
        other.trackers.map((tracker) => ({ ...tracker, ownerName: other.name }))
      );
  };

  const handleAssignTracker = async (tracker: CustomerTracker) => {
    if (!selectedCustomer) return;

    try {
      await apiFetch(`/api/trackers/${encodeURIComponent(tracker.trackerId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(selectedCustomer.id) }),
      });
      loadCustomers();
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to assign tracker');
    } finally {
      setIsAssignOpen(false);
      setSelectedCustomer(null);
    }
  };

  // Opens the dialog
  const confirmDeleteCustomer = (customer: Customer) => {
    setCustomerToDelete(customer);
    setIsDeleteOpen(true);
  };

  // Actually deletes after confirmation
  const handleDeleteCustomer = async () => {
    if (!customerToDelete) return;

    try {
      await apiFetch(`/api/users/${customerToDelete.id}`, {
        method: 'DELETE',
      });

      setCustomers((prev) =>
        prev.filter((customer) => customer.id !== customerToDelete.id)
      );
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to delete customer');
    } finally {
      setIsDeleteOpen(false);
      setCustomerToDelete(null);
    }
  };

  // Replaces the customer's password with a generated one, shown once.
  const handleGeneratePassword = async () => {
    if (!customerToReset) return;

    try {
      const data = await apiFetch(`/api/users/${customerToReset.id}/password`, {
        method: 'POST',
      });
      setNewLogin({ email: data.email, password: data.password });
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to generate a new password');
    } finally {
      setCustomerToReset(null);
    }
  };

  const otherTrackers = getOtherTrackers(selectedCustomer);

  return (
    <AdminPageGuard>
      <div className="space-y-6 p-4 sm:p-6">
        {/* Header */}
        <div className="flex justify-between">
          <div>
            <h1 className="text-3xl font-bold">Customers</h1>
            <p className="text-muted-foreground">
              Manage customers and assign trackers
            </p>
          </div>

          <Button
            onClick={() => {
              resetForm();
              setIsAddOpen(true);
            }}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
        </div>

        {loadError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {loadError}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Total</CardTitle>
            </CardHeader>
            <CardContent>{customers.length}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>With Trackers</CardTitle>
            </CardHeader>
            <CardContent>{customersWithTrackers}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trackers Assigned</CardTitle>
            </CardHeader>
            <CardContent>{totalTrackers}</CardContent>
          </Card>
        </div>

        {/* Customers List */}
        <div className="space-y-4">
          {customers.map((customer) => (
            <Card key={customer.id} className="rounded-2xl">
              <CardContent className="flex flex-col gap-5 p-6 md:flex-row md:items-start md:justify-between">
                {/* Left */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-lg font-semibold leading-none">
                      {customer.company || customer.name}
                    </h2>
                  </div>

                  {customer.company && (
                    <p className="text-sm font-medium">
                      {customer.name}
                    </p>
                  )}

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span>{customer.email}</span>
                  </div>
                </div>

                {/* Right */}
                <div className="flex w-full flex-col gap-3 md:w-70">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setIsAssignOpen(true);
                    }}
                  >
                    Assign Tracker
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setCustomerToReset(customer)}
                  >
                    Generate New Password
                  </Button>

                  <Button
                    size="sm"
                    variant="destructive"
                    className="w-full"
                    onClick={() => confirmDeleteCustomer(customer)}
                  >
                    Delete Customer
                  </Button>

                  <div className="mt-1 space-y-2">
                    {customer.trackers.length > 0 ? (
                      customer.trackers.map((tracker) => (
                        <div
                          key={tracker.trackerId}
                          className="rounded-lg border bg-muted/30 p-3 text-sm"
                        >
                          <p className="font-medium">{tracker.name ?? tracker.trackerId}</p>
                          <p className="text-xs text-muted-foreground">
                            {tracker.licensePlate ?? tracker.trackerId}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="pt-1 text-sm text-muted-foreground">
                        No Trackers
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Add Customer Sheet */}
        <Sheet open={isAddOpen} onOpenChange={setIsAddOpen}>
          <SheetContent className="px-6">
            <SheetHeader className="px-0">
              <SheetTitle>Add Customer</SheetTitle>
              <SheetDescription>
                Create a customer login. To create one together with a device, use Add
                Device on the Devices page.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-3">
              {formError && <p className="text-red-500">{formError}</p>}

              <Input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />

              <Input
                placeholder="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <Input
                placeholder="Password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <Input
                placeholder="Company (optional)"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />

              <Button onClick={handleAddCustomer}>Save</Button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Assign Tracker Sheet */}
        <Sheet open={isAssignOpen} onOpenChange={setIsAssignOpen}>
          <SheetContent className="px-6">
            <SheetHeader className="px-0">
              <SheetTitle>Assign Tracker</SheetTitle>
              <SheetDescription>
                Move a tracker to {selectedCustomer?.company || selectedCustomer?.name}. New
                trackers are registered on the Devices page.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-2">
              {otherTrackers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No trackers belong to other customers.
                </p>
              )}

              {otherTrackers.map((tracker) => (
                <button
                  key={tracker.trackerId}
                  onClick={() => handleAssignTracker(tracker)}
                  className="w-full border p-3 text-left rounded hover:bg-muted"
                >
                  <p>{tracker.name ?? tracker.trackerId}</p>
                  <p className="text-xs text-muted-foreground">
                    {tracker.licensePlate ?? tracker.trackerId} · currently {tracker.ownerName}
                  </p>
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {/* Generate password: confirmation, then the new login shown once */}
      <Dialog open={customerToReset !== null} onOpenChange={(open) => !open && setCustomerToReset(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate New Password</DialogTitle>
            <DialogDescription>
              Replace the password of{' '}
              <span className="font-semibold text-foreground">{customerToReset?.name}</span>? Their
              current password stops working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setCustomerToReset(null)}>
              Cancel
            </Button>
            <Button onClick={handleGeneratePassword}>Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newLogin !== null} onOpenChange={(open) => !open && setNewLogin(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New password</DialogTitle>
            <DialogDescription>
              Give these login details to the customer. The password is not shown again; they
              can change it in Settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Email</span>
              <span className="break-all font-mono">{newLogin?.email}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Password</span>
              <span className="font-mono">{newLogin?.password}</span>
            </div>
          </div>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() =>
                navigator.clipboard?.writeText(
                  `Email: ${newLogin?.email}\nPassword: ${newLogin?.password}`
                )
              }
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
            <Button onClick={() => setNewLogin(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold text-foreground">
                {customerToDelete?.name}
              </span>
              ? Their trackers and all tracking data are deleted too. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteOpen(false);
                setCustomerToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCustomer}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPageGuard>
  );
}
