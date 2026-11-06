
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  MapPin, Navigation, RefreshCw, ShieldCheck,
  Clock, Wifi, WifiOff, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type SharedLocation = {
  vehicle: {
    name: string;
    licensePlate: string | null;
  };
  location: {
    latitude: number;
    longitude: number;
    recordedAt: string | null;
  } | null;
  online: boolean;
  allowLive: boolean;
  expiresAt: string;
};

function formatDate(value: string | null) {
  if (!value) return 'Unknown';

  return new Date(value).toLocaleString();
}

export default function PublicLocationPage() {
  const params = useParams();
  const token = String(params.token || '');

  const [data, setData] = useState<SharedLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(
        `/api/public/location/${encodeURIComponent(token)}`,
        {
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setData(null);
        throw new Error(
          response.status === 404
            ? 'This sharing link has expired or been revoked.'
            : result.message || 'Unable to load vehicle location.'
        );
      }

      setData(result);
      setError('');
      setLastChecked(new Date());
    } catch (err: any) {
      setError(err?.message || 'Unable to update location');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!data?.allowLive || error) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    }, 15000);

    return () => window.clearInterval(interval);
  }, [data?.allowLive, error, refresh]);

  const location = data?.location;
  const validLocation =
    location &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude);

  const mapsUrl = validLocation
    ? `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
    : '';

  const directionsUrl = validLocation
    ? `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`
    : '';

  const mapUrl = validLocation
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${
        location.longitude - 0.006
      }%2C${location.latitude - 0.004}%2C${
        location.longitude + 0.006
      }%2C${location.latitude + 0.004}&layer=mapnik&marker=${
        location.latitude
      }%2C${location.longitude}`
    : '';

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin" />
          <p>Loading shared location...</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center">
          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />

          <h1 className="text-xl font-bold">
            Location Unavailable
          </h1>

          <p className="mt-3 text-sm text-muted-foreground">
            {error || 'This sharing link is no longer available.'}
          </p>

          <Button
            className="mt-5"
            variant="outline"
            onClick={() => void refresh()}
          >
            Try Again
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary p-2 text-primary-foreground">
              <MapPin className="h-5 w-5" />
            </div>

            <div>
              <h1 className="font-bold">FleetTrack</h1>
              <p className="text-xs text-muted-foreground">
                Shared Vehicle Location
              </p>
            </div>
          </div>

          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 p-4 pb-10">
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">
                {data.vehicle.name}
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                {data.vehicle.licensePlate || 'Vehicle tracking'}
              </p>
            </div>

            {data.online ? (
              <span className="flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1 text-sm text-green-600">
                <Wifi className="h-4 w-4" />
                Online
              </span>
            ) : (
              <span className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm">
                <WifiOff className="h-4 w-4" />
                Offline
              </span>
            )}
          </div>

          {!data.allowLive && (
            <p className="mt-4 rounded-lg border p-3 text-sm text-muted-foreground">
              This is a fixed location snapshot. It will not
              update when the vehicle moves.
            </p>
          )}

          {!data.online && data.allowLive && (
            <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              This tracker is currently offline. The position
              below is the last GPS location received, not the
              vehicle's confirmed current location.
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card">
          {validLocation ? (
            <iframe
              title="Shared vehicle location map"
              src={mapUrl}
              className="h-[380px] w-full border-0 sm:h-[480px]"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-72 flex-col items-center justify-center p-5 text-center">
              <MapPin className="mb-3 h-10 w-10 text-muted-foreground" />

              <h3 className="font-semibold">
                No GPS Location Available
              </h3>

              <p className="mt-2 text-sm text-muted-foreground">
                The tracker has not sent a valid GPS position yet.
                A position will appear when one becomes available.
              </p>
            </div>
          )}
        </div>

        {validLocation && (
          <div className="grid gap-3 sm:grid-cols-2">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 items-center justify-center gap-2 rounded-lg border bg-card px-4 text-sm font-medium hover:bg-muted"
            >
              <MapPin className="h-4 w-4" />
              Open in Google Maps
            </a>

            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              <Navigation className="h-4 w-4" />
              Get Directions
            </a>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4" />
              GPS Recorded At
            </p>

            <p className="mt-2 text-sm text-muted-foreground">
              {formatDate(location?.recordedAt || null)}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <p className="text-sm font-medium">
              Link Expires
            </p>

            <p className="mt-2 text-sm text-muted-foreground">
              {formatDate(data.expiresAt)}
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => void refresh()}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh Location
        </Button>

        {lastChecked && (
          <p className="text-center text-xs text-muted-foreground">
            Last checked: {lastChecked.toLocaleTimeString()}
            {data.allowLive ? ' · Updates every 15 seconds' : ''}
          </p>
        )}

        <p className="text-center text-xs text-muted-foreground">
          This link provides read-only location access.
          The vehicle owner may revoke access at any time.
        </p>
      </div>
    </main>
  );
}
