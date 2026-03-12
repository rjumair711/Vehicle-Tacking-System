'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { generateMockGeofences } from '@/lib/mockData';
import { Geofence } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MapPin, Plus, Edit2, Trash2 } from 'lucide-react';

export default function GeofencesPage() {
  const router = useRouter();
  const { user, checkPermission, isLoading } = useAuth();
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [selectedGeofence, setSelectedGeofence] = useState<Geofence | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    setGeofences(generateMockGeofences());
  }, []);

  if (isLoading || !user) return null;

  const handleAddGeofence = () => {
    setSelectedGeofence(null);
    setIsCreateMode(true);
    setIsSheetOpen(true);
  };

  const handleEditGeofence = (geofence: Geofence) => {
    setSelectedGeofence(geofence);
    setIsCreateMode(false);
    setIsSheetOpen(true);
  };

  const handleDeleteGeofence = (id: string) => {
    setGeofences((prev) => prev.filter((g) => g.id !== id));
  };

  const handleSaveGeofence = (data: any) => {
    if (isCreateMode) {
      const newGeofence: Geofence = {
        id: `geo-${Date.now()}`,
        createdAt: new Date(),
        companyId: 'company-001',
        ...data,
      };
      setGeofences((prev) => [...prev, newGeofence]);
    } else if (selectedGeofence) {
      setGeofences((prev) =>
        prev.map((g) => (g.id === selectedGeofence.id ? { ...g, ...data } : g))
      );
    }
    setIsSheetOpen(false);
  };

  const canManageGeofences = checkPermission('manager');

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Geofences</h1>
          <p className="mt-2 text-muted-foreground">Set up and manage virtual boundaries</p>
        </div>
        {canManageGeofences && (
          <Button onClick={handleAddGeofence}>
            <Plus className="mr-2 h-4 w-4" />
            Add Geofence
          </Button>
        )}
      </div>

      {/* Geofences List */}
      <div className="grid gap-4">
        {geofences.map((geofence) => (
          <Card key={geofence.id} className="border-border bg-card">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div
                    className="mt-1 h-4 w-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: geofence.color }}
                  />
                  <div>
                    <CardTitle className="text-lg">{geofence.name}</CardTitle>
                    {geofence.description && (
                      <CardDescription>{geofence.description}</CardDescription>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={geofence.type === 'inclusion' ? 'default' : 'destructive'}>
                    {geofence.type === 'inclusion' ? 'Inclusion' : 'Exclusion'}
                  </Badge>
                  {canManageGeofences && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditGeofence(geofence)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteGeofence(geofence.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Location */}
                <div className="rounded-lg border border-border bg-muted/50 p-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Center Location</p>
                  <p className="text-sm font-mono text-foreground">
                    {geofence.center.lat.toFixed(4)}, {geofence.center.lng.toFixed(4)}
                  </p>
                </div>

                {/* Radius */}
                <div className="rounded-lg border border-border bg-muted/50 p-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Radius</p>
                  <p className="text-sm font-medium text-foreground">{geofence.radius} meters</p>
                </div>

                {/* Alerts */}
                <div className="sm:col-span-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Alert Settings</p>
                  <div className="flex flex-wrap gap-2">
                    {geofence.alertOnEnter && (
                      <Badge variant="outline">Alert on Entry</Badge>
                    )}
                    {geofence.alertOnExit && (
                      <Badge variant="outline">Alert on Exit</Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Geofence Editor Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="bottom" className="h-[85vh] max-h-[85vh] sm:max-w-2xl mx-auto">
          {!isCreateMode && selectedGeofence ? (
            <>
              <SheetHeader>
                <SheetTitle>Edit Geofence</SheetTitle>
                <SheetDescription>Modify geofence settings</SheetDescription>
              </SheetHeader>
              <GeofenceForm
                geofence={selectedGeofence}
                onSave={handleSaveGeofence}
                onClose={() => setIsSheetOpen(false)}
              />
            </>
          ) : (
            <>
              <SheetHeader>
                <SheetTitle>Create Geofence</SheetTitle>
                <SheetDescription>Set up a new virtual boundary</SheetDescription>
              </SheetHeader>
              <GeofenceForm
                onSave={handleSaveGeofence}
                onClose={() => setIsSheetOpen(false)}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface GeofenceFormProps {
  geofence?: Geofence;
  onSave: (data: any) => void;
  onClose: () => void;
}

function GeofenceForm({ geofence, onSave, onClose }: GeofenceFormProps) {
  const [formData, setFormData] = useState({
    name: geofence?.name || '',
    description: geofence?.description || '',
    radius: geofence?.radius || 500,
    type: geofence?.type || 'inclusion',
    color: geofence?.color || '#3b82f6',
    alertOnEnter: geofence?.alertOnEnter || false,
    alertOnExit: geofence?.alertOnExit || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      center: geofence?.center || { lat: 37.7749, lng: -122.4194 },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <label className="text-sm font-medium text-foreground">Geofence Name</label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Downtown Office"
          required
          className="mt-1"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">Description</label>
        <Input
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Optional description"
          className="mt-1"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-foreground">Radius (meters)</label>
          <Input
            type="number"
            value={formData.radius}
            onChange={(e) => setFormData({ ...formData, radius: parseInt(e.target.value) })}
            min="100"
            max="10000"
            step="100"
            className="mt-1"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">Type</label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
            className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground"
          >
            <option value="inclusion">Inclusion Zone</option>
            <option value="exclusion">Exclusion Zone</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">Color</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="color"
            value={formData.color}
            onChange={(e) => setFormData({ ...formData, color: e.target.value })}
            className="h-10 w-14 rounded-lg border border-border cursor-pointer"
          />
          <span className="text-sm text-muted-foreground">{formData.color}</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Alerts</label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.alertOnEnter}
              onChange={(e) => setFormData({ ...formData, alertOnEnter: e.target.checked })}
              className="rounded border-border"
            />
            <span className="text-sm text-foreground">Alert when vehicle enters</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.alertOnExit}
              onChange={(e) => setFormData({ ...formData, alertOnExit: e.target.checked })}
              className="rounded border-border"
            />
            <span className="text-sm text-foreground">Alert when vehicle exits</span>
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onClose} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" className="flex-1">
          {geofence ? 'Update' : 'Create'} Geofence
        </Button>
      </div>
    </form>
  );
}
