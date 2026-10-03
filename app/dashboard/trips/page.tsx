'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { fetchTrips, formatSpeed, useApiData } from '@/lib/api';
import { Trip } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Gauge, Clock, Navigation2 } from 'lucide-react';

type TripFilter = 'all' | 'active' | 'completed';

const filters: { id: TripFilter; label: string }[] = [
  { id: 'all', label: 'All Trips' },
  { id: 'active', label: 'Active Trips' },
  { id: 'completed', label: 'Completed' },
];

export default function TripsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { data: trips, loading, error } = useApiData<Trip[]>(fetchTrips, [], 30000);
  const [filter, setFilter] = useState<TripFilter>('all');

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const formatTime = (date: Date) => date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const formatDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const openTripOnMap = (trip: Trip) => {
    router.push(
      `/dashboard/map?tripId=${encodeURIComponent(trip.id)}&trackerId=${encodeURIComponent(trip.trackerId)}`
    );
  };

  const visibleTrips = trips.filter((trip) => filter === 'all' || trip.status === filter);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Trips</h1>
        <p className="mt-2 text-muted-foreground">
          One trip per tracker per day. Select a trip to see its route on the map.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button key={item.id} onClick={() => setFilter(item.id)}>
            <Badge variant={filter === item.id ? 'default' : 'outline'}>{item.label}</Badge>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && visibleTrips.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No trips yet. A trip appears here once a tracker has reported movement.
        </p>
      )}

      {/* Trips List */}
      <div className="space-y-3">
        {visibleTrips.map((trip) => (
          <button
            key={`${trip.id}-${trip.startTime.getTime()}`}
            onClick={() => openTripOnMap(trip)}
            className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted transition-colors p-4"
          >
            <div className="grid gap-4 md:grid-cols-5">
              {/* Tracker Info */}
              <div className="md:col-span-1">
                <p className="font-semibold text-foreground">{trip.trackerName ?? trip.trackerId}</p>
                <p className="text-xs text-muted-foreground mt-1">{trip.licensePlate ?? trip.trackerId}</p>
              </div>

              {/* Time Info */}
              <div className="md:col-span-1">
                <div className="flex items-center gap-1 text-xs">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-foreground">
                    {formatTime(trip.startTime)}
                    {trip.endTime ? ` – ${formatTime(trip.endTime)}` : ''}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{formatDate(trip.startTime)}</p>
              </div>

              {/* Distance & Duration */}
              <div className="md:col-span-1">
                <div className="flex items-center gap-1 text-sm">
                  <Navigation2 className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">{trip.distance.toFixed(2)} km</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{formatDuration(trip.duration)}</p>
              </div>

              {/* Speed Stats */}
              <div className="md:col-span-1">
                <div className="flex items-center gap-1 text-sm">
                  <Gauge className="h-4 w-4 text-primary" />
                  <span className="text-foreground">{formatSpeed(trip.averageSpeed, user.speedUnit)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  avg · max {formatSpeed(trip.maxSpeed, user.speedUnit)}
                </p>
              </div>

              {/* Status */}
              <div className="md:col-span-1 flex items-center justify-end">
                <Badge variant={trip.status === 'active' ? 'default' : 'secondary'}>
                  {trip.status.charAt(0).toUpperCase() + trip.status.slice(1)}
                </Badge>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
