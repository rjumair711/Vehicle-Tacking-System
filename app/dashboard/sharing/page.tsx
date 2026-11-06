
'use client';

import React, {
  useCallback, useEffect, useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { apiFetch } from '@/lib/api';
import { useLiveTrackers } from '@/lib/realtime';
import { TrackingDevice } from '@/types';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  MapPin, Link2, Copy, UserPlus,
  Trash2, Wifi, WifiOff, RefreshCw,
  ExternalLink, ShieldCheck,
} from 'lucide-react';

type Viewer = {
  id: string;
  name: string;
  email: string;
};

type ShareLink = {
  id: string;
  allowLive: boolean;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
};

type CreatedLink = {
  url: string;
  expiresAt: string;
};

function formatTime(value: Date | string | null | undefined) {
  if (!value) return 'Never';

  return new Date(value).toLocaleString();
}

export default function SharingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const {
    data: allTrackers,
    loading,
    error,
  } = useLiveTrackers();

  useEffect(() => {
    if (!isLoading && !user) router.push('/');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const owned = allTrackers.filter((t) => !t.shared);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-3xl font-bold">
          Location Sharing
        </h1>
        <p className="mt-2 text-muted-foreground">
          Share live or last-known vehicle locations
          securely with people you trust.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && (
        <p className="text-sm text-muted-foreground">
          Loading vehicles...
        </p>
      )}

      {!loading && !error && owned.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <MapPin className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-semibold">No owned vehicles</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Register a tracker to start sharing locations.
            </p>
          </CardContent>
        </Card>
      )}

      {owned.map((tracker) => (
        <VehicleSharing
          key={tracker.trackerId}
          tracker={tracker}
        />
      ))}
    </div>
  );
}

function VehicleSharing({
  tracker,
}: {
  tracker: TrackingDevice;
}) {
  const base = `/api/trackers/${encodeURIComponent(
    tracker.trackerId
  )}`;

  const [links, setLinks] = useState<ShareLink[]>([]);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const [shareOpen, setShareOpen] = useState(false);
  const [duration, setDuration] = useState(60);
  const [allowLive, setAllowLive] = useState(true);
  const [createdLink, setCreatedLink] =
    useState<CreatedLink | null>(null);

  const [revokeId, setRevokeId] = useState<string | null>(null);

  const loadAccess = useCallback(async () => {
    try {
      const [linkData, viewerData] = await Promise.all([
        apiFetch(`${base}/share-links`),
        apiFetch(`${base}/shares`),
      ]);

      setLinks(linkData.links || []);
      setViewers(viewerData.viewers || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load sharing access');
    }
  }, [base]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  const createLink = async () => {
    setSaving(true);
    setError('');

    try {
      const response = await apiFetch(`${base}/share-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationMinutes: duration,
          allowLive,
        }),
      });

      setCreatedLink({
        url: response.link.url,
        expiresAt: response.link.expiresAt,
      });

      setShareOpen(false);
      setNotice('Secure sharing link created.');
      await loadAccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to create link');
    } finally {
      setSaving(false);
    }
  };

  const revokeLink = async () => {
    if (!revokeId) return;

    setSaving(true);
    setError('');

    try {
      await apiFetch(`${base}/share-links/${revokeId}`, {
        method: 'DELETE',
      });

      setRevokeId(null);
      setNotice('Sharing link revoked.');
      await loadAccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to revoke link');
    } finally {
      setSaving(false);
    }
  };

  const inviteViewer = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) return;

    setSaving(true);
    setError('');

    try {
      await apiFetch(`${base}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
        }),
      });

      setEmail('');
      setNotice('Viewer access granted.');
      await loadAccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to invite viewer');
    } finally {
      setSaving(false);
    }
  };

  const removeViewer = async (viewer: Viewer) => {
    if (
      !window.confirm(
        `Stop sharing this vehicle with ${viewer.name}?`
      )
    ) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      await apiFetch(
        `${base}/shares?userId=${encodeURIComponent(viewer.id)}`,
        { method: 'DELETE' }
      );

      setNotice(`Access revoked for ${viewer.name}.`);
      await loadAccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove viewer');
    } finally {
      setSaving(false);
    }
  };

  const location = tracker.location;

  const mapsUrl = location
    ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`
    : '';

  const activeLinks = links.filter(
    (link) =>
      link.active &&
      new Date(link.expiresAt).getTime() > Date.now()
  );

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">
              {tracker.name || tracker.trackerId}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {tracker.licensePlate || tracker.trackerId}
            </p>
          </div>

          <span className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
            {tracker.status === 'online' ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4" />
            )}
            {tracker.status.toUpperCase()}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {notice && (
          <p role="status" className="rounded-lg border p-3 text-sm">
            {notice}
          </p>
        )}

        {/* Vehicle location */}
        <div className="rounded-xl border bg-muted/20 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <MapPin className="h-4 w-4" />
            Last Known Location
          </p>

          {location ? (
            <div className="mt-3 space-y-2">
              <p className="font-mono text-sm">
                {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
              </p>

              <p className="text-xs text-muted-foreground">
                GPS recorded: {formatTime(location.timestamp)}
              </p>

              {tracker.status !== 'online' && (
                <p className="text-xs text-amber-600">
                  Tracker is offline. This position may be outdated.
                </p>
              )}

              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              >
                Open in Google Maps
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No GPS position received yet.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            onClick={() => setShareOpen(true)}
            className="w-full"
          >
            <Link2 className="mr-2 h-4 w-4" />
            Create Location Link
          </Button>

          <Button
            variant="outline"
            onClick={() => void loadAccess()}
            className="w-full"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Access
          </Button>
        </div>

        {/* Temporary links */}
        <section className="space-y-3 border-t pt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              Temporary Sharing Links
            </h3>

            <span className="text-xs text-muted-foreground">
              {activeLinks.length} active
            </span>
          </div>

          {!activeLinks.length ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">
              No active links. Create one to share this
              vehicle's location on another device.
            </p>
          ) : (
            activeLinks.map((link) => (
              <div
                key={link.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {link.allowLive
                      ? 'Live Location Link'
                      : 'Fixed Location Snapshot'}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Expires: {formatTime(link.expiresAt)}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRevokeId(link.id)}
                >
                  Revoke
                </Button>
              </div>
            ))
          )}
        </section>

        {/* Registered viewer sharing */}
        <section className="space-y-3 border-t pt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              Registered Viewers
            </h3>

            <span className="text-xs text-muted-foreground">
              {viewers.length} viewers
            </span>
          </div>

          {viewers.map((viewer) => (
            <div
              key={viewer.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="font-medium">{viewer.name}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {viewer.email}
                </p>
              </div>

              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                aria-label={`Remove ${viewer.name}`}
                onClick={() => void removeViewer(viewer)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}

          <form
            onSubmit={inviteViewer}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <Input
              type="email"
              placeholder="Existing user's email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Button
              type="submit"
              disabled={saving || !email.trim()}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Add Viewer
            </Button>
          </form>

          <p className="text-xs text-muted-foreground">
            Registered viewers need an existing FleetTrack
            account. For friends without accounts, use a
            temporary location link.
          </p>
        </section>

        {/* Create link dialog */}
        <Dialog open={shareOpen} onOpenChange={setShareOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Location Link</DialogTitle>
              <DialogDescription>
                Share {tracker.name || tracker.trackerId}
                {' '}securely without giving someone your login.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Link expires after
                </label>

                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={duration}
                  onChange={(e) =>
                    setDuration(Number(e.target.value))
                  }
                >
                  <option value={15}>15 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={1440}>24 hours</option>
                </select>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <input
                  type="checkbox"
                  checked={allowLive}
                  onChange={(e) =>
                    setAllowLive(e.target.checked)
                  }
                  className="mt-1"
                />

                <span>
                  <span className="block text-sm font-medium">
                    Allow location updates
                  </span>

                  <span className="block text-xs text-muted-foreground">
                    When enabled, new GPS positions become
                    visible until the link expires. Otherwise,
                    share only the current snapshot.
                  </span>
                </span>
              </label>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Anyone with the link can view the location.
                Only share it with people you trust.
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setShareOpen(false)}
              >
                Cancel
              </Button>

              <Button disabled={saving} onClick={createLink}>
                {saving ? 'Creating...' : 'Create Secure Link'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Show newly created link */}
        <Dialog
          open={createdLink !== null}
          onOpenChange={(open) => {
            if (!open) setCreatedLink(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Location Link Created</DialogTitle>
              <DialogDescription>
                Copy this link and send it to someone you trust.
                It will not be displayed again after closing.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <Input
                readOnly
                value={createdLink?.url || ''}
                aria-label="Temporary sharing link"
              />

              <p className="text-xs text-muted-foreground">
                Expires: {formatTime(createdLink?.expiresAt)}
              </p>

              <Button
                className="w-full"
                variant="outline"
                onClick={async () => {
                  if (!createdLink) return;

                  try {
                    await navigator.clipboard.writeText(
                      createdLink.url
                    );
                    setNotice('Link copied.');
                  } catch {
                    setNotice('Copy failed. Please copy the URL manually.');
                  }
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy Link
              </Button>

              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  `Shared vehicle location: ${createdLink?.url || ''}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 items-center justify-center rounded-md bg-green-600 px-4 text-sm font-medium text-white"
              >
                Share on WhatsApp
              </a>
            </div>

            <DialogFooter>
              <Button onClick={() => setCreatedLink(null)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Revoke confirmation */}
        <Dialog
          open={revokeId !== null}
          onOpenChange={(open) => {
            if (!open && !saving) setRevokeId(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Revoke Location Access?</DialogTitle>
              <DialogDescription>
                Anyone using this link will lose access
                immediately. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => setRevokeId(null)}
              >
                Cancel
              </Button>

              <Button
                variant="destructive"
                disabled={saving}
                onClick={revokeLink}
              >
                {saving ? 'Revoking...' : 'Revoke Link'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
