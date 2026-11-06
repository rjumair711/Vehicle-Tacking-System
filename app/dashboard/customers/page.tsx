'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminPageGuard from '@/components/AdminPageGuard';
import { apiFetch } from '@/lib/api';
import { Customer, CustomerTracker } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { UserPlus, Building2, Mail, Eye, EyeOff } from 'lucide-react';

interface NewCustomerForm {
  name: string;
  email: string;
  company: string;
  password: string;
  confirmPassword: string;
}

const initialForm: NewCustomerForm = {
  name: '', email: '', company: '', password: '', confirmPassword: '',
};

const passwordValid = (password: string) => password.length >= 8 && password.length <= 128;

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState<NewCustomerForm>(initialForm);
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await apiFetch('/api/users');
      setCustomers(data.users || []);
      setLoadError('');
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to fetch customers');
    }
  }, []);

  useEffect(() => { void loadCustomers(); }, [loadCustomers]);

  const totalTrackers = customers.reduce((sum, customer) => sum + customer.trackers.length, 0);
  const customersWithTrackers = customers.filter((c) => c.trackers.length > 0).length;

  const handleAddCustomer = async () => {
    setFormError('');
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setFormError('Name, email, and password are required.'); return;
    }
    if (!passwordValid(form.password)) {
      setFormError('Password must contain 8–128 characters.'); return;
    }
    if (form.password !== form.confirmPassword) {
      setFormError('Passwords do not match.'); return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.name.trim(), email: form.email.trim(),
          password: form.password, company: form.company.trim() || undefined,
        }),
      });
      setIsAddOpen(false);
      setForm(initialForm);
      setShowPassword(false);
      setNotice('Customer created successfully with the password you entered.');
      await loadCustomers();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create customer.');
    } finally { setSaving(false); }
  };

  const getOtherTrackers = (customer: Customer | null) => {
    if (!customer) return [];
    return customers.filter((other) => other.id !== customer.id)
      .flatMap((other) => other.trackers.map((tracker) => ({ ...tracker, ownerName: other.name })));
  };

  const handleAssignTracker = async (tracker: CustomerTracker) => {
    if (!selectedCustomer) return;
    try {
      await apiFetch(`/api/trackers/${encodeURIComponent(tracker.trackerId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(selectedCustomer.id) }),
      });
      setNotice('Tracker assigned successfully.');
      await loadCustomers();
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to assign tracker.');
    } finally { setIsAssignOpen(false); setSelectedCustomer(null); }
  };

  const handleDeleteCustomer = async () => {
    if (!customerToDelete) return;
    setSaving(true);
    try {
      await apiFetch(`/api/users/${customerToDelete.id}`, { method: 'DELETE' });
      setCustomers((prev) => prev.filter((c) => c.id !== customerToDelete.id));
      setNotice('Customer deleted.');
      setCustomerToDelete(null);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to delete customer.');
    } finally { setSaving(false); }
  };

  const otherTrackers = getOtherTrackers(selectedCustomer);

  return (
    <AdminPageGuard>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Customers</h1>
            <p className="text-muted-foreground">Manage customers and assign trackers</p>
          </div>
          <Button onClick={() => { setForm(initialForm); setFormError(''); setShowPassword(false); setIsAddOpen(true); }}>
            <UserPlus className="mr-2 h-4 w-4" /> Add Customer
          </Button>
        </div>

        {loadError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>}
        {notice && <p role="status" className="rounded-md border px-3 py-2 text-sm">{notice}</p>}

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardHeader><CardTitle>Total</CardTitle></CardHeader><CardContent>{customers.length}</CardContent></Card>
          <Card><CardHeader><CardTitle>With Trackers</CardTitle></CardHeader><CardContent>{customersWithTrackers}</CardContent></Card>
          <Card><CardHeader><CardTitle>Trackers Assigned</CardTitle></CardHeader><CardContent>{totalTrackers}</CardContent></Card>
        </div>

        <div className="space-y-4">
          {customers.map((customer) => (
            <Card key={customer.id} className="rounded-2xl">
              <CardContent className="flex flex-col gap-5 p-6 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">{customer.company || customer.name}</h2>
                  </div>
                  {customer.company && <p className="text-sm font-medium">{customer.name}</p>}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" /><span>{customer.email}</span>
                  </div>
                </div>
                <div className="flex w-full flex-col gap-3 md:w-70">
                  <Button size="sm" onClick={() => { setSelectedCustomer(customer); setIsAssignOpen(true); }}>Assign Tracker</Button>
                  <Button size="sm" variant="destructive" onClick={() => setCustomerToDelete(customer)}>Delete Customer</Button>
                  <div className="mt-1 space-y-2">
                    {customer.trackers.length ? customer.trackers.map((tracker) => (
                      <div key={tracker.trackerId} className="rounded-lg border bg-muted/30 p-3 text-sm">
                        <p className="font-medium">{tracker.name ?? tracker.trackerId}</p>
                        <p className="text-xs text-muted-foreground">{tracker.licensePlate ?? tracker.trackerId}</p>
                      </div>
                    )) : <p className="pt-1 text-sm text-muted-foreground">No Trackers</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Sheet open={isAddOpen} onOpenChange={(open) => { if (!saving) setIsAddOpen(open); }}>
          <SheetContent className="overflow-y-auto px-6">
            <SheetHeader className="px-0">
              <SheetTitle>Add Customer</SheetTitle>
              <SheetDescription>Create a customer login with a password you choose. You can assign trackers later.</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 pt-4">
              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
              <Input aria-label="Customer name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input aria-label="Customer email" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <Input aria-label="Company" placeholder="Company (optional)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <div className="relative">
                <Input aria-label="Password" placeholder="Password (8+ characters)" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="pr-10" />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setShowPassword((v) => !v)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              <Input aria-label="Confirm password" placeholder="Confirm password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
              <Button disabled={saving} onClick={handleAddCustomer}>{saving ? 'Saving...' : 'Create Customer'}</Button>
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={isAssignOpen} onOpenChange={setIsAssignOpen}>
          <SheetContent className="overflow-y-auto px-6">
            <SheetHeader className="px-0">
              <SheetTitle>Assign Tracker</SheetTitle>
              <SheetDescription>Move a tracker to {selectedCustomer?.company || selectedCustomer?.name}. New trackers are registered on the Devices page.</SheetDescription>
            </SheetHeader>
            <div className="space-y-2 pt-4">
              {!otherTrackers.length && <p className="text-sm text-muted-foreground">No trackers belong to other customers.</p>}
              {otherTrackers.map((tracker) => (
                <button key={tracker.trackerId} type="button" onClick={() => handleAssignTracker(tracker)} className="w-full rounded border p-3 text-left hover:bg-muted">
                  <p>{tracker.name ?? tracker.trackerId}</p>
                  <p className="text-xs text-muted-foreground">{tracker.licensePlate ?? tracker.trackerId} · currently {tracker.ownerName}</p>
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>

        <Dialog open={customerToDelete !== null} onOpenChange={(open) => { if (!open && !saving) setCustomerToDelete(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Customer</DialogTitle>
              <DialogDescription>Delete {customerToDelete?.name}? Their trackers and all tracking data are deleted too. This cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setCustomerToDelete(null)}>Cancel</Button>
              <Button variant="destructive" disabled={saving} onClick={handleDeleteCustomer}>{saving ? 'Deleting...' : 'Delete'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminPageGuard>
  );
}
