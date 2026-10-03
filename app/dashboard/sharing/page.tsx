'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { apiFetch, fetchTrackers, useApiData } from '@/lib/api';
import { TrackingDevice } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Copy, Trash2, UserPlus } from 'lucide-react';

interface Viewer {
  id: string;
  name: string;
  email: string;
}

interface InvitedViewer extends Viewer {
  created: boolean;
  password: string | null;
}

export default function SharingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { data: allTrackers, loading, error } = useApiData<TrackingDevice[]>(fetchTrackers, []);

  const [invited, setInvited] = useState<InvitedViewer | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  // Only vehicles the user owns can be shared.
  const trackers = allTrackers.filter((tracker) => !tracker.shared);

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Location Sharing</h1>
        <p className="mt-2 text-muted-foreground">
          Let someone else see where a vehicle is right now. A viewer sees the live map only:
          no trips, alerts or geofences.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && trackers.length === 0 && (
        <p className="text-sm text-muted-foreground">You have no vehicles to share yet.</p>
      )}

      {trackers.map((tracker) => (
        <TrackerSharing key={tracker.trackerId} tracker={tracker} onInvited={setInvited} />
      ))}

      {/* Result of an invite */}
      <Dialog open={invited !== null} onOpenChange={(open) => !open && setInvited(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vehicle shared</DialogTitle>
            <DialogDescription>
              {invited?.created
                ? 'A viewer account was created. Give these login details to the viewer. The password is not shown again.'
                : `${invited?.name} can now see this vehicle on their live map with their existing login.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Email</span>
              <span className="break-all font-mono">{invited?.email}</span>
            </div>
            {invited?.created && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Password</span>
                <span className="font-mono">{invited.password}</span>
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2 sm:justify-end">
            {invited?.created && (
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard?.writeText(
                    `Email: ${invited.email}\nPassword: ${invited.password}`
                  )
                }
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            )}
            <Button onClick={() => setInvited(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TrackerSharing({
  tracker,
  onInvited,
}: {
  tracker: TrackingDevice;
  onInvited: (viewer: InvitedViewer) => void;
}) {
  const sharesUrl = `/api/trackers/${encodeURIComponent(tracker.trackerId)}/shares`;

  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const loadViewers = useCallback(async () => {
    try {
      const data = await apiFetch(sharesUrl);
      setViewers(data.viewers ?? []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load viewers');
    }
  }, [sharesUrl]);

  useEffect(() => {
    loadViewers();
  }, [loadViewers]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setIsSaving(true);
      setError('');

      const data = await apiFetch(sharesUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });

      onInvited(data.viewer);
      setEmail('');
      setName('');
      setNeedsName(false);
      loadViewers();
    } catch (err: any) {
      setError(err?.message || 'Failed to share the vehicle');
      if (err?.code === 'VIEWER_NAME_REQUIRED') setNeedsName(true);
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (viewer: Viewer) => {
    if (!window.confirm(`Stop sharing this vehicle with ${viewer.name}?`)) return;

    try {
      setError('');
      await apiFetch(`${sharesUrl}?userId=${viewer.id}`, { method: 'DELETE' });
      loadViewers();
    } catch (err: any) {
      setError(err?.message || 'Failed to stop sharing');
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle>{tracker.name ?? tracker.trackerId}</CardTitle>
        <CardDescription>{tracker.licensePlate ?? tracker.trackerId}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {viewers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not shared with anyone.</p>
        ) : (
          <div className="space-y-2">
            {viewers.map((viewer) => (
              <div
                key={viewer.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{viewer.name}</p>
                  <p className="break-all text-xs text-muted-foreground">{viewer.email}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(viewer)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            placeholder="Viewer's email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {needsName && (
            <Input
              placeholder="Viewer's name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <Button type="submit" disabled={isSaving || !email} className="shrink-0">
            <UserPlus className="mr-2 h-4 w-4" />
            {isSaving ? 'Sharing...' : 'Share'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
