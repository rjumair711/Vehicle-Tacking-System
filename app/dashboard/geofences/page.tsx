'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/authContext';
import { apiFetch, fetchGeofences, fetchTrackers, useApiData } from '@/lib/api';
import { Geofence, TrackingDevice } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Edit2, Trash2, Undo2 } from 'lucide-react';

const GeofenceMap = dynamic(
  () => import('@/components/GeofenceMap').then((m) => m.GeofenceMap),
  { ssr: false }
);

type Point = { lat: number; lng: number };

interface GeofenceFormData {
  trackerId: string;
  name: string;
  description: string;
  color: string;
  alertOnEnter: boolean;
  alertOnExit: boolean;
  points: Point[];
}

export default function GeofencesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const { data: geofences, loading, error, refresh } = useApiData<Geofence[]>(fetchGeofences, []);
  const { data: allTrackers } = useApiData<TrackingDevice[]>(fetchTrackers, []);

  const [editing, setEditing] = useState<Geofence | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  // A zone can only be put on a vehicle the user owns, not one shared with them.
  const trackers = allTrackers.filter((tracker) => !tracker.shared);

  const openEditor = (geofence: Geofence | null) => {
    setEditing(geofence);
    setFormError('');
    setIsSheetOpen(true);
  };

  const handleDeleteGeofence = async (geofence: Geofence) => {
    if (!window.confirm(`Delete geofence "${geofence.name}"?`)) return;

    try {
      setActionError('');
      await apiFetch(`/api/geofences/${geofence.id}`, { method: 'DELETE' });
      refresh();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to delete geofence');
    }
  };

  const handleSaveGeofence = async (data: GeofenceFormData) => {
    try {
      setFormError('');

      await apiFetch(editing ? `/api/geofences/${editing.id}` : '/api/geofences', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      setIsSheetOpen(false);
      refresh();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save geofence');
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Geofences</h1>
          <p className="mt-2 text-muted-foreground">
            Draw a zone for a vehicle and get an alert when it enters or leaves
          </p>
        </div>
        <Button onClick={() => openEditor(null)} disabled={trackers.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Add Geofence
        </Button>
      </div>

      {(error || actionError) && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error || actionError}
        </div>
      )}

      {!loading && !error && geofences.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {trackers.length === 0
            ? 'You need a tracker before you can add a geofence.'
            : 'No geofences yet. Use Add Geofence to draw the first zone.'}
        </p>
      )}

      {/* All zones on one map */}
      {geofences.length > 0 && (
        <Card className="border-border bg-card">
          <CardContent className="h-[45vh] p-0 overflow-hidden rounded-xl">
            <GeofenceMap key={geofences.map((g) => g.id).join('-')} geofences={geofences} />
          </CardContent>
        </Card>
      )}

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
                    <CardDescription>
                      {geofence.trackerName ?? geofence.trackerId}
                      {geofence.description ? ` · ${geofence.description}` : ''}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openEditor(geofence)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteGeofence(geofence)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{geofence.points.length} corners</Badge>
                {geofence.alertOnEnter && <Badge variant="outline">Alert on Entry</Badge>}
                {geofence.alertOnExit && <Badge variant="outline">Alert on Exit</Badge>}
                {!geofence.alertOnEnter && !geofence.alertOnExit && (
                  <Badge variant="outline">No alerts</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Geofence Editor Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent
          side="bottom"
          className="h-[92vh] max-h-[92vh] sm:max-w-3xl mx-auto flex flex-col overflow-hidden"
        >
          <SheetHeader className="px-5 pr-14">
            <SheetTitle>{editing ? 'Edit Geofence' : 'Create Geofence'}</SheetTitle>
            <SheetDescription>
              Click the map to place each corner of the zone, going around its edge
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-8">
            {isSheetOpen && (
              <GeofenceForm
                key={editing?.id ?? 'new'}
                geofence={editing ?? undefined}
                trackers={trackers}
                otherGeofences={geofences.filter((g) => g.id !== editing?.id)}
                error={formError}
                onSave={handleSaveGeofence}
                onClose={() => setIsSheetOpen(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface GeofenceFormProps {
  geofence?: Geofence;
  trackers: TrackingDevice[];
  otherGeofences: Geofence[];
  error: string;
  onSave: (data: GeofenceFormData) => Promise<void>;
  onClose: () => void;
}

function GeofenceForm({ geofence, trackers, otherGeofences, error, onSave, onClose }: GeofenceFormProps) {
  const [formData, setFormData] = useState<GeofenceFormData>({
    trackerId: geofence?.trackerId || trackers[0]?.trackerId || '',
    name: geofence?.name || '',
    description: geofence?.description || '',
    color: geofence?.color || '#3b82f6',
    alertOnEnter: geofence?.alertOnEnter ?? true,
    alertOnExit: geofence?.alertOnExit ?? true,
    points: geofence?.points || [],
  });
  const [isSaving, setIsSaving] = useState(false);

  const selectedTracker = trackers.find((t) => t.trackerId === formData.trackerId);
  const canSave = formData.points.length >= 3 && formData.name.trim() !== '' && formData.trackerId !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    setIsSaving(true);
    await onSave(formData);
    setIsSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-4 pb-6">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-foreground">Geofence Name</label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Home, Office, City limits"
            required
            className="mt-1"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">Vehicle</label>
          <select
            value={formData.trackerId}
            onChange={(e) => setFormData({ ...formData, trackerId: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground"
          >
            {trackers.map((tracker) => (
              <option key={tracker.trackerId} value={tracker.trackerId}>
                {tracker.name ?? tracker.trackerId}
                {tracker.licensePlate ? ` (${tracker.licensePlate})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">
            Zone ({formData.points.length} {formData.points.length === 1 ? 'corner' : 'corners'})
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={formData.points.length === 0}
              onClick={() => setFormData({ ...formData, points: formData.points.slice(0, -1) })}
            >
              <Undo2 className="mr-1 h-4 w-4" />
              Undo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={formData.points.length === 0}
              onClick={() => setFormData({ ...formData, points: [] })}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="mt-2 h-[42vh] overflow-hidden rounded-lg border border-border">
          <GeofenceMap
            geofences={otherGeofences}
            drawing={formData.points}
            drawingColor={formData.color}
            onDrawingChange={(points) => setFormData((prev) => ({ ...prev, points }))}
            fallbackCenter={selectedTracker?.location}
          />
        </div>
        {formData.points.length < 3 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Place at least 3 corners to make a zone.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-foreground">Description</label>
          <Input
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Optional description"
            className="mt-1"
          />
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
            <span className="text-sm text-foreground">Alert when the vehicle enters</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.alertOnExit}
              onChange={(e) => setFormData({ ...formData, alertOnExit: e.target.checked })}
              className="rounded border-border"
            />
            <span className="text-sm text-foreground">Alert when the vehicle leaves</span>
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-4 pb-2">
        <Button type="button" variant="outline" onClick={onClose} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={!canSave || isSaving}>
          {isSaving ? 'Saving...' : geofence ? 'Update Geofence' : 'Create Geofence'}
        </Button>
      </div>
    </form>
  );
}
