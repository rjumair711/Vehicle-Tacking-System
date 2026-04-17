'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AdminPageGuard from '@/components/AdminPageGuard';
import { generateMockCustomers, generateMockVehicles } from '@/lib/mockData';
import { Customer, Vehicle } from '@/types';

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
import { Label } from '@/components/ui/label';

import { UserPlus, Building2, Mail, CarFront } from 'lucide-react';

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
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const [form, setForm] = useState<NewCustomerForm>(initialForm);
  const [formError, setFormError] = useState('');

  // Load mock data
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
        assignedVehicleIds: [],
        createdAt: new Date(),
      }));

      setCustomers(mappedCustomers);
    } catch (err) {
      console.error(err);
    }
  };

  loadUsers();
  setVehicles(generateMockVehicles());
}, []);

  // Stats
  const activeCustomers = useMemo(
    () => customers.filter((c) => c.status === 'active').length,
    [customers]
  );

  // Reset form
  const resetForm = () => {
    setForm(initialForm);
    setFormError('');
  };

  // Add Customer
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
          name: form.name,
          email: form.email,
          password: '123456', // temporary default password
          company: form.company,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch users');
      }

      const data = await res.json();
      setCustomers(data.users || []);

      if (!res.ok) {
        throw new Error(data.message || 'Failed to create user');
      }

      // add to UI immediately
      setCustomers((prev) => [
        {
          ...data.user,
          assignedVehicleIds: [],
          status: 'active',
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

  // Get assigned vehicles
  const getAssignedVehicles = (ids: string[]) => {
    return vehicles.filter((v) => ids.includes(v.id));
  };

  // Get unassigned vehicles
  const getUnassignedVehicles = () => {
    const assignedIds = customers.flatMap((c) => c.assignedVehicleIds);
    return vehicles.filter((v) => !assignedIds.includes(v.id));
  };

  // Assign vehicle
  const handleAssignVehicle = (vehicleId: string) => {
    if (!selectedCustomer) return;

    setCustomers((prev) =>
      prev.map((c) =>
        c.id === selectedCustomer.id
          ? {
            ...c,
            assignedVehicleIds: [...c.assignedVehicleIds, vehicleId],
          }
          : c
      )
    );

    setIsAssignOpen(false);
    setSelectedCustomer(null);
  };

  return (
    <AdminPageGuard>
      <div className="space-y-6 p-4 sm:p-6">

        {/* Header */}
        <div className="flex justify-between">
          <div>
            <h1 className="text-3xl font-bold">Customers</h1>
            <p className="text-muted-foreground">
              Manage customers and assign vehicles
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
            <CardHeader><CardTitle>Total</CardTitle></CardHeader>
            <CardContent>{customers.length}</CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Active</CardTitle></CardHeader>
            <CardContent>{activeCustomers}</CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Vehicles Assigned</CardTitle></CardHeader>
            <CardContent>
              {customers.reduce((sum, c) => sum + c.assignedVehicleIds.length, 0)}
            </CardContent>
          </Card>
        </div>

        {/* Customers List */}
        <div className="space-y-4">
          {customers.map((customer) => {
            const assignedVehicles = getAssignedVehicles(
              customer.assignedVehicleIds
            );

            return (
              <Card key={customer.id}>
                <CardContent className="p-5 flex justify-between">

                  {/* Left */}
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      <h2 className="font-semibold">{customer.company}</h2>
                      <Badge>
                        {customer.status}
                      </Badge>
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
                      Assign Vehicle
                    </Button>

                    {assignedVehicles.length > 0 ? (
                      assignedVehicles.map((v) => (
                        <div key={v.id} className="text-sm border p-2 mb-2 rounded">
                          <p>{v.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {v.licensePlate}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No vehicles
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

        {/* Assign Vehicle Sheet */}
        <Sheet open={isAssignOpen} onOpenChange={setIsAssignOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Assign Vehicle</SheetTitle>
              <SheetDescription>
                Assign to {selectedCustomer?.company}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-2">
              {getUnassignedVehicles().map((v) => (
                <button
                  key={v.id}
                  onClick={() => handleAssignVehicle(v.id)}
                  className="w-full border p-3 text-left rounded hover:bg-muted"
                >
                  <p>{v.name}</p>
                  <p className="text-xs">{v.licensePlate}</p>
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>

      </div>
    </AdminPageGuard>
  );
}