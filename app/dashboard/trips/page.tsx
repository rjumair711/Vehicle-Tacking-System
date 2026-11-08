
'use client';

import React, {
  useEffect,
  useMemo,
  useState
} from 'react';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';

import {
  fetchTrips,
  formatSpeed,
  useApiData
} from '@/lib/api';

import type { Trip } from '@/types';
import { Badge } from '@/components/ui/badge';

import {
  ArrowRight,
  CalendarDays,
  CarFront,
  Clock3,
  Gauge,
  Loader2,
  MapPinned,
  Navigation2,
  RefreshCw,
  Route,
  Search,
  TrendingUp,
  X
} from 'lucide-react';

type TripFilter = 'all' | 'active' | 'completed';

const tabs: {
  id: TripFilter;
  label: string;
}[] = [
    { id: 'all', label: 'All trips' },
    { id: 'active', label: 'Today / Active' },
    { id: 'completed', label: 'Completed' }
  ];

const TIME_ZONE =
  process.env.NEXT_PUBLIC_TRIP_TIME_ZONE ||
  'Asia/Karachi';

const readDate = (value: unknown): Date =>
  value instanceof Date
    ? value
    : new Date(String(value ?? ''));

const dayKey = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);

const fmtTime = (value: unknown) => {
  const date = readDate(value);

  if (!Number.isFinite(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-PK', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
};

const fmtDate = (value: unknown) => {
  const date = readDate(value);

  if (!Number.isFinite(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat('en-PK', {
    timeZone: TIME_ZONE,
    dateStyle: 'medium'
  }).format(date);
};

const fmtDuration = (
  value: number | null | undefined
) => {
  const minutes = Number(value);

  if (
    !Number.isFinite(minutes) ||
    minutes < 0
  ) {
    return '—';
  }

  const total = Math.round(minutes);

  return total >= 60
    ? `${Math.floor(total / 60)}h ${total % 60}m`
    : `${total}m`;
};

const n = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const km = (distance: unknown) =>
  `${n(distance).toFixed(2)} km`;

function Stat({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{
    className?: string;
  }>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>

      <p className="text-2xl font-bold tracking-tight text-foreground">
        {value}
      </p>

      <p className="mt-1 text-xs font-medium text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function TripCard({
  trip,
  onOpen,
  speedUnit
}: {
  trip: Trip;
  onOpen: () => void;
  speedUnit: Parameters<typeof formatSpeed>[1];
}) {
  const active = trip.status === 'active';

  const vehicle =
    trip.trackerName || trip.trackerId;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View route for ${vehicle} on ${fmtDate(trip.startTime)}`}
      className="group w-full rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <CarFront className="h-5 w-5 text-primary" />
          </div>

          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-foreground">
              {vehicle}
            </p>

            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {trip.licensePlate || trip.trackerId}
            </p>
          </div>
        </div>

        <Badge
          variant={active ? 'default' : 'secondary'}
        >
          {active ? 'Today' : 'Completed'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 py-4 md:grid-cols-4">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Trip time window
          </div>

          <p className="text-sm font-semibold text-foreground">
            {fmtTime(trip.startTime)}
            {' – '}
            {trip.endTime
              ? fmtTime(trip.endTime)
              : 'Now'}
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            {fmtDuration(trip.duration)}
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Navigation2 className="h-3.5 w-3.5" />
            Distance
          </div>

          <p className="text-sm font-semibold text-foreground">
            {km(trip.distance)}
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            Recorded GPS
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" />
            Avg. moving speed
          </div>

          <p className="text-sm font-semibold text-foreground">
            {formatSpeed(
              n(trip.averageSpeed),
              speedUnit
            )}
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            Max{' '}
            {formatSpeed(
              n(trip.maxSpeed),
              speedUnit
            )}
          </p>
        </div>

        <div className="flex items-end md:items-center md:justify-end">
          <span className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <MapPinned className="h-4 w-4" />
            View road path
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </button>
  );
}

export default function TripsPage() {
  const router = useRouter();

  const {
    user,
    isLoading: authLoading
  } = useAuth();

  const {
    data: apiTrips,
    loading,
    error
  } = useApiData<Trip[]>(
    fetchTrips,
    [],
    30000
  );

  const [filter, setFilter] =
    useState<TripFilter>('all');

  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(20);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/');
    }
  }, [authLoading, user, router]);

  const trips = useMemo(() => {
    return [...(apiTrips || [])].sort(
      (a, b) =>
        readDate(b.startTime).getTime() -
        readDate(a.startTime).getTime()
    );
  }, [apiTrips]);

  const filtered = useMemo(() => {
    return trips.filter(trip => {
      if (
        filter !== 'all' &&
        trip.status !== filter
      ) {
        return false;
      }

      const term =
        search.trim().toLowerCase();

      if (!term) return true;

      return [
        trip.trackerName,
        trip.trackerId,
        trip.licensePlate
      ].some(value =>
        String(value || '')
          .toLowerCase()
          .includes(term)
      );
    });
  }, [trips, filter, search]);

  const shown = filtered.slice(0, limit);

  const groups = useMemo(() => {
    const output = new Map<string, Trip[]>();

    for (const trip of shown) {
      const key = dayKey(
        readDate(trip.startTime)
      );

      output.set(key, [
        ...(output.get(key) || []),
        trip
      ]);
    }

    return [...output.entries()];
  }, [shown]);

  const activeCount = trips.filter(
    trip => trip.status === 'active'
  ).length;

  const totalKm = trips.reduce(
    (sum, trip) =>
      sum + n(trip.distance),
    0
  );

  const vehicles = new Set(
    trips.map(trip => trip.trackerId)
  ).size;

  const openOnMap = (trip: Trip) => {
    router.push(
      `/dashboard/map?tripId=${encodeURIComponent(trip.id)}&trackerId=${encodeURIComponent(trip.trackerId)}`
    );
  };

  if (authLoading || !user) {
    return null;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 pb-12 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <Route className="h-4 w-4" />
            Fleet activity
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Trip history
          </h1>

          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            One journey per vehicle per day.
            Open any trip to explore its
            recorded road-by-road route.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''
              }`}
          />

          Refreshes every 30 sec
        </div>
      </header>

      <section
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label="Trip overview"
      >
        <Stat
          label="Recent trips (up to 500)"
          value={String(trips.length)}
          icon={Route}
        />

        <Stat
          label="Trips today"
          value={String(activeCount)}
          icon={TrendingUp}
        />

        <Stat
          label="Recorded distance"
          value={`${totalKm.toFixed(1)} km`}
          icon={Navigation2}
        />

        <Stat
          label="Vehicles with trips"
          value={String(vehicles)}
          icon={CarFront}
        />
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Filter trips"
          >
            {tabs.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setFilter(item.id);
                  setLimit(20);
                }}
                aria-pressed={
                  filter === item.id
                }
                className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${filter === item.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

            <input
              type="search"
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                setLimit(20);
              }}
              aria-label="Search vehicle or plate"
              placeholder="Search vehicle or plate…"
              className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />

            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <RefreshCw className="h-4 w-4 shrink-0" />

          Unable to load trips:
          {' '}
          {String(error)}
        </div>
      )}

      {loading &&
        trips.length === 0 &&
        !error && (
          <div
            className="space-y-3"
            aria-live="polite"
          >
            {[0, 1, 2].map(index => (
              <div
                key={index}
                className="h-40 animate-pulse rounded-2xl border border-border bg-muted/60"
              />
            ))}

            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading trip history…
            </p>
          </div>
        )}

      {!loading &&
        !error &&
        filtered.length === 0 && (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <MapPinned className="mb-4 h-10 w-10 text-muted-foreground" />

            <h2 className="text-base font-semibold text-foreground">
              No matching trips
            </h2>

            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {trips.length === 0
                ? 'A trip appears once a tracker reports at least two moving GPS positions.'
                : 'Try a different vehicle search or filter.'}
            </p>

            {(search ||
              filter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter('all');
                    setSearch('');
                  }}
                  className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Clear filters
                </button>
              )}
          </div>
        )}

      <div className="space-y-7">
        {groups.map(
          ([date, dayTrips]) => (
            <section key={date}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />

                  <h2 className="text-sm font-bold text-foreground">
                    {fmtDate(
                      dayTrips[0].startTime
                    )}
                  </h2>
                </div>

                <p className="text-xs text-muted-foreground">
                  {dayTrips.length}
                  {' '}
                  {dayTrips.length === 1
                    ? 'trip'
                    : 'trips'}
                </p>
              </div>

              <div className="space-y-3">
                {dayTrips.map(trip => (
                  <TripCard
                    key={`${trip.id}-${String(trip.startTime)}`}
                    trip={trip}
                    speedUnit={
                      user.speedUnit
                    }
                    onOpen={() =>
                      openOnMap(trip)
                    }
                  />
                ))}
              </div>
            </section>
          )
        )}
      </div>

      {!error &&
        shown.length < filtered.length && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() =>
                setLimit(value => value + 20)
              }
              className="rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Show more (
              {filtered.length - shown.length}
              {' '}
              remaining)
            </button>
          </div>
        )}
    </div>
  );
}
