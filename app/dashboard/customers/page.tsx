'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AdminPageGuard from '@/components/AdminPageGuard';
import { generateMockTrackers } from '@/lib/mockData';
import { Customer, TrackingDevice } from '@/types';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { Input } from '@/components/ui/input';

import { UserPlus, Building2, Mail } from 'lucide-react';

interface NewCustomerForm {
  name: string;
  email: string;
  company: string;
  phone: string;
  status: 'active' | 'inactive';
}

const initialForm: NewCustomerForm = {
  name: '',
  email: '',
  company: '',
  phone: '',
  status: 'active',
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [trackers, setTrackers] = useState<TrackingDevice[]>([]);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const [form, setForm] = useState<NewCustomerForm>(initialForm);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const res = await fetch('/api/users', {
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error('Failed to fetch users');
        }

        const data = await res.json();

        const mappedCustomers: Customer[] = (data.users || []).map((user: any) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          company: user.company || 'No Company',
          phone: '',
          status: 'active',
          assignedTrackerIds: [],
          createdAt: new Date(),
        }));

        setCustomers(mappedCustomers);
      } catch (err) {
        console.error(err);
      }
    };

    loadUsers();
    setTrackers(generateMockTrackers());
  }, []);

  const activeCustomers = useMemo(
    () => customers.filter((c) => c.status === 'active').length,
    [customers]
  );

  const resetForm = () => {
    setForm(initialForm);
    setFormError('');
  };

  const handleAddCustomer = async () => {
    try {
      setFormError('');

      if (!form.name || !form.email || !form.company) {
        setFormError('All fields are required');
        return;
      }

      const res = await fetch('/api/users', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: form.name,
          email: form.email,
          password: '123456'
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to create user');
      }

      setCustomers((prev) => [
        {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          company: data.user.company || form.company,
          phone: '',
          status: 'active',
          assignedTrackerIds: [],
          createdAt: new Date(),
        },
        ...prev,
      ]);

      setIsAddOpen(false);
      resetForm();
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  const getAssignedTrackers = (ids: string[]) => {
    return trackers.filter((tracker) => ids.includes(tracker.trackerId));
  };

  const getUnassignedTrackers = () => {
    const assignedIds = customers.flatMap((customer) => customer.assignedTrackerIds);
    return trackers.filter((tracker) => !assignedIds.includes(tracker.trackerId));
  };

  const handleAssignTracker = (trackerId: string) => {
    if (!selectedCustomer) return;

    setCustomers((prev) =>
      prev.map((customer) =>
        customer.id === selectedCustomer.id
          ? {
            ...customer,
            assignedTrackerIds: [
              ...customer.assignedTrackerIds,
              trackerId,
            ],
          }
          : customer
      )
    );

    setIsAssignOpen(false);
    setSelectedCustomer(null);
  };

  const handleDeleteCustomer = async (customerId: string) => {
    const confirmDelete = confirm(
      "Are you sure you want to delete this customer?"
    );

    if (!confirmDelete) return;

    try {
      const res = await fetch(`/api/users/${customerId}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to delete customer");
      }

      setCustomers((prev) =>
        prev.filter((customer) => customer.id !== customerId)
      );
    } catch (err: any) {
      alert(err.message);
    }
  };

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
              <CardTitle>Active</CardTitle>
            </CardHeader>
            <CardContent>{activeCustomers}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trackers Assigned</CardTitle>
            </CardHeader>
            <CardContent>
              {customers.reduce(
                (sum, customer) => sum + customer.assignedTrackerIds.length,
                0
              )}
            </CardContent>
          </Card>
        </div>

        {/* Customers List */}
        <div className="space-y-4">
          {customers.map((customer) => {
            const assignedTrackers = getAssignedTrackers(
              customer.assignedTrackerIds
            );

            return (
              <Card key={customer.id}>
                <CardContent className="p-5 flex justify-between">
                  {/* Left */}
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      <h2 className="font-semibold">{customer.company}</h2>
                      <Badge>{customer.status}</Badge>
                    </div>

                    <p>{customer.name}</p>

                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      {customer.email}
                    </div>
                  </div>

                  {/* Right */}
                  <div className="w-[250px]">
                    <Button
                      size="sm"
                      className="w-full mb-3"
                      onClick={() => {
                        setSelectedCustomer(customer);
                        setIsAssignOpen(true);
                      }}
                    >
                      Assign Tracker
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="w-full"
                      onClick={() => handleDeleteCustomer(customer.id)}
                    >
                      Delete Customer
                    </Button>

                    {assignedTrackers.length > 0 ? (
                      assignedTrackers.map((tracker) => (
                        <div
                          key={tracker.trackerId}
                          className="text-sm border p-2 mb-2 rounded"
                        >
                          <p>{tracker.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {tracker.licensePlate}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No Trackers
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Add Customer Sheet */}
        <Sheet open={isAddOpen} onOpenChange={setIsAddOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Add Customer</SheetTitle>
              <SheetDescription>Create a new customer</SheetDescription>
            </SheetHeader>

            <div className="space-y-3 mt-4">
              {formError && <p className="text-red-500">{formError}</p>}

              <Input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />

              <Input
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />

              <Input
                placeholder="Company"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />

              <Button onClick={handleAddCustomer}>Save</Button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Assign Tracker Sheet */}
        <Sheet open={isAssignOpen} onOpenChange={setIsAssignOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Assign Tracker</SheetTitle>
              <SheetDescription>
                Assign to {selectedCustomer?.company}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-2">
              {getUnassignedTrackers().map((tracker) => (
                <button
                  key={tracker.trackerId}
                  onClick={() => handleAssignTracker(tracker.trackerId)}
                  className="w-full border p-3 text-left rounded hover:bg-muted"
                >
                  <p>{tracker.name}</p>
                  <p className="text-xs">{tracker.licensePlate}</p>
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </AdminPageGuard>
  );
}