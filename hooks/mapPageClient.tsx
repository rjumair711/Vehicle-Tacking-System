
'use client';

import React, {
  useEffect,
  useState
} from 'react';

import {
  useRouter,
  useSearchParams
} from 'next/navigation';

import dynamic from 'next/dynamic';

import { useAuth } from '@/lib/authContext';

import {
  formatLastSeen,
  formatSpeed
} from '@/lib/api';

import { useLiveTrackers } from '@/lib/realtime';

import type { TrackingDevice } from '@/types';

import type {
  TripRouteDetail
} from '@/components/TripRouteLayer';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';

import { Badge } from '@/components/ui/badge';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';

import {
  ArrowLeft,
  CalendarDays,
  CarFront,
  Clock3,
  Gauge,
  Loader2,
  MapPin,
  Navigation2,
  Route,
  Smartphone,
  User
} from 'lucide-react';

const VehicleMap = dynamic(
  () =>
    import('@/components/VehicleMap').then(
      module => module.VehicleMap
    ),
  {
    ssr: false
  }
);

const TripHistoryMap = dynamic(
  () => import('@/components/TripHistoryMap'),
  {
    ssr: false
  }
);

type TripDetail = TripRouteDetail & {
  id: string;
  trackerId: string;
  trackerName: string | null;
  licensePlate: string | null;

  startTime: Date;
  endTime: Date | null;

  distance: number;
  duration: number;
  averageSpeed: number;
  maxSpeed: number;

  status: 'active' | 'completed';
};

type TripApiResponse = {
  success: boolean;
  trip?: Record<string, any>;
  message?: string;
};

function numberValue(value: unknown): number {
  if (value == null) return 0;

  const num = Number(value);

  return Number.isFinite(num) ? num : 0;
}

function stringValue(
  value: unknown,
  fallback = ''
): string {
  return typeof value === 'string'
    ? value
    : fallback;
}

function parseTrip(
  raw: Record<string, any>
): TripDetail {
  const startTime = new Date(
    raw.startTime ?? raw.start_time
  );

  const endTimeRaw =
    raw.endTime ?? raw.end_time;

  const endTime = endTimeRaw
    ? new Date(endTimeRaw)
    : null;

  const calculatedDuration =
    endTime &&
    Number.isFinite(startTime.getTime()) &&
    Number.isFinite(endTime.getTime())
      ? Math.max(
          0,
          Math.round(
            (
              endTime.getTime() -
              startTime.getTime()
            ) / 60000
          )
        )
      : 0;

  return {
    id: String(
      raw.id ?? raw.trip_id ?? ''
    ),

    trackerId: String(
      raw.trackerId ??
      raw.tracker_id ??
      ''
    ),

    trackerName:
      raw.trackerName ??
      raw.name ??
      null,

    licensePlate:
      raw.licensePlate ??
      raw.license_plate ??
      null,

    startTime,
    endTime,

    distance: numberValue(
      raw.distance ??
      raw.total_distance
    ),

    duration: numberValue(
      raw.duration ?? calculatedDuration
    ),

    averageSpeed: numberValue(
      raw.averageSpeed ??
      raw.average_speed
    ),

    maxSpeed: numberValue(
      raw.maxSpeed ??
      raw.max_speed
    ),

    status:
      raw.status === 'active'
        ? 'active'
        : 'completed',

    route_geojson:
      raw.route_geojson ??
      raw.routeGeoJson ??
      null,

    road_segments:
      raw.road_segments ??
      raw.roadSegments ??
      [],

    gps_segments:
      raw.gps_segments ??
      raw.gpsSegments ??
      [],

    road_match_status:
      raw.road_match_status ??
      raw.roadMatchStatus ??
      'gps-only',

    route_line:
      raw.route_line ??
      raw.routeLine ??
      [],

    inferred_ranges:
      raw.inferred_ranges ??
      raw.inferredRanges ??
      [],

    road_match_configured:
      raw.road_match_configured ??
      raw.roadMatchConfigured ??
      undefined,

    gps_points_count: numberValue(
      raw.gps_points_count ??
      raw.gpsPointsCount
    )
  };
}

function displayDate(date: Date): string {
  if (
    !Number.isFinite(date.getTime())
  ) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat(
    'en-PK',
    {
      timeZone: 'Asia/Karachi',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }
  ).format(date);
}

function displayTime(
  date: Date | null
): string {
  if (
    !date ||
    !Number.isFinite(date.getTime())
  ) {
    return '—';
  }

  return new Intl.DateTimeFormat(
    'en-PK',
    {
      timeZone: 'Asia/Karachi',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }
  ).format(date);
}

function displayDuration(
  minutes: number
): string {
  const total = Math.max(
    0,
    Math.round(minutes)
  );

  if (total < 60) {
    return `${total} min`;
  }

  return `${Math.floor(total / 60)}h ${total % 60}m`;
}

function DetailRow({
  label,
  value
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-3 last:border-0">
      <span className="text-sm text-muted-foreground">
        {label}
      </span>

      <span className="text-right text-sm font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}

function TripSummary({
  trip,
  speedUnit,
  onBack
}: {
  trip: TripDetail;
  speedUnit: Parameters<typeof formatSpeed>[1];
  onBack: () => void;
}) {
  const routeStatus =
    trip.road_match_status || 'gps-only';

  const hasRoadMatch =
    routeStatus === 'matched';

  const partial =
    routeStatus === 'partial';

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-5 w-5 text-primary" />
            Trip details
          </CardTitle>

          <Badge
            variant={
              trip.status === 'active'
                ? 'default'
                : 'secondary'
            }
          >
            {trip.status === 'active'
              ? 'Today'
              : 'Completed'}
          </Badge>
        </div>

        <CardDescription>
          Vehicle journey and GPS route information
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <CarFront className="h-5 w-5 text-primary" />
            </div>

            <div className="min-w-0">
              <p className="break-words font-semibold text-foreground">
                {trip.trackerName ||
                  trip.trackerId}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {trip.licensePlate ||
                  trip.trackerId}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border px-4">
          <DetailRow
            label="Date"
            value={displayDate(
              trip.startTime
            )}
          />

          <DetailRow
            label="Start"
            value={displayTime(
              trip.startTime
            )}
          />

          <DetailRow
            label="Last movement"
            value={displayTime(
              trip.endTime
            )}
          />

          <DetailRow
            label="Elapsed time"
            value={displayDuration(
              trip.duration
            )}
          />

          <DetailRow
            label="GPS distance"
            value={`${trip.distance.toFixed(2)} km`}
          />

          <DetailRow
            label="Average speed"
            value={formatSpeed(
              trip.averageSpeed,
              speedUnit
            )}
          />

          <DetailRow
            label="Max speed"
            value={formatSpeed(
              trip.maxSpeed,
              speedUnit
            )}
          />

          <DetailRow
            label="GPS points"
            value={
              trip.gps_points_count ?? 0
            }
          />
        </div>

        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="mb-2 text-sm font-semibold text-foreground">
            Route accuracy
          </p>

          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                hasRoadMatch
                  ? 'bg-emerald-500'
                  : partial
                    ? 'bg-amber-500'
                    : 'bg-slate-400'
              }`}
            />

            <span className="text-sm font-medium text-foreground">
              {hasRoadMatch
                ? 'Matched to roads'
                : partial
                  ? 'Partially matched'
                  : 'GPS trace only'}
            </span>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {hasRoadMatch
              ? 'The GPS observations have been matched to nearby roads. This is an estimate based on the recorded positions.'
              : partial
                ? 'Most of the route follows matched roads. Sections the matcher could not place are estimated connections.'
                : 'A reliable road match is unavailable. The recorded GPS trace is displayed instead.'}
          </p>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to trips
        </button>
      </CardContent>
    </Card>
  );
}

export default function MapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    user,
    isLoading
  } = useAuth();

  const tripIdFromUrl =
    searchParams.get('tripId');

  const trackerIdFromUrl =
    searchParams.get('trackerId');

  const isTripView =
    Boolean(tripIdFromUrl);

  // Keep live tracking exactly as before.
  // Your existing hook pauses while viewing a trip.
  const {
    data: trackers,
    error: trackersError,
    live
  } = useLiveTrackers(isTripView);

  const [selectedTrip, setSelectedTrip] =
    useState<TripDetail | null>(null);

  const [loadedTripId, setLoadedTripId] =
    useState<string | null>(null);

  const [tripLoading, setTripLoading] =
    useState(false);

  const [tripError, setTripError] =
    useState('');

  const [
    selectedTrackerId,
    setSelectedTrackerId
  ] = useState<string>();

  const [
    isSheetOpen,
    setIsSheetOpen
  ] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/');
    }
  }, [
    isLoading,
    user,
    router
  ]);

  useEffect(() => {
    setSelectedTrackerId(
      trackerIdFromUrl || undefined
    );
  }, [trackerIdFromUrl]);

  useEffect(() => {
    const controller =
      new AbortController();

    setSelectedTrip(null);
    setLoadedTripId(null);
    setTripError('');

    if (!tripIdFromUrl || !user) {
      setTripLoading(false);
      return;
    }

    setTripLoading(true);

    const loadTrip = async () => {
      try {
        const response = await fetch(
          `/api/trips?tripId=${encodeURIComponent(
            tripIdFromUrl
          )}`,
          {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal
          }
        );

        const data =
          await response.json() as TripApiResponse;

        if (!response.ok || !data.success || !data.trip) {
          throw new Error(
            data.message ||
            `Unable to load trip (${response.status})`
          );
        }

        const parsed = parseTrip(
          data.trip
        );

        if (
          !Number.isFinite(
            parsed.startTime.getTime()
          )
        ) {
          throw new Error(
            'Trip contains an invalid start time'
          );
        }

        if (!controller.signal.aborted) {
          setSelectedTrip(parsed);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setTripError(
          error instanceof Error
            ? error.message
            : 'Failed to load trip'
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoadedTripId(tripIdFromUrl);
          setTripLoading(false);
        }
      }
    };

    void loadTrip();

    return () => {
      controller.abort();
    };
  }, [
    tripIdFromUrl,
    user
  ]);

  const selectedTracker =
    trackers.find(
      tracker =>
        tracker.trackerId ===
        selectedTrackerId
    );

  const currentTrip =
    loadedTripId === tripIdFromUrl
      ? selectedTrip
      : null;

  const isCurrentTripLoading =
    isTripView &&
    (
      tripLoading ||
      loadedTripId !== tripIdFromUrl
    );

  if (isLoading || !user) {
    return null;
  }

  const statusVariant = (
    status: TrackingDevice['status']
  ): 'default' | 'secondary' | 'outline' =>
    status === 'online'
      ? 'default'
      : status === 'offline'
        ? 'secondary'
        : 'outline';

  const backToTrips = () =>
    router.push('/dashboard/trips');

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6 lg:flex-row">
      <div className="min-w-0 flex-1">
        <Card className="h-full overflow-hidden border-border bg-card shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  {isTripView ? (
                    <Route className="h-5 w-5 text-primary" />
                  ) : (
                    <MapPin className="h-5 w-5 text-primary" />
                  )}

                  {isTripView
                    ? 'Trip route map'
                    : 'Live vehicle map'}
                </CardTitle>

                <CardDescription className="mt-1">
                  {isTripView
                    ? currentTrip
                      ? `${currentTrip.trackerName || currentTrip.trackerId} · ${displayDate(currentTrip.startTime)}`
                      : tripError || 'Loading recorded route'
                    : trackersError ||
                      (
                        live
                          ? 'Real-time GPS locations'
                          : 'Updating locations every 5 seconds'
                      )}
                </CardDescription>
              </div>

              {isTripView ? (
                <button
                  type="button"
                  onClick={backToTrips}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Trips
                </button>
              ) : (
                <Badge
                  variant={
                    live
                      ? 'default'
                      : 'secondary'
                  }
                >
                  {live
                    ? 'Live'
                    : 'Refreshing'}
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="h-[60vh] min-h-[350px] p-0 lg:h-[75vh]">
            {isTripView ? (
              isCurrentTripLoading ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/30">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />

                  <p className="text-sm font-medium text-foreground">
                    Preparing your trip route…
                  </p>

                  <p className="text-center text-xs text-muted-foreground">
                    Loading GPS points and road-matched sections
                  </p>
                </div>
              ) : currentTrip ? (
                <TripHistoryMap
                  key={currentTrip.id}
                  trip={currentTrip}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <MapPin className="h-10 w-10 text-muted-foreground" />

                  <p className="font-semibold text-foreground">
                    Could not display trip
                  </p>

                  <p
                    role="alert"
                    className="max-w-md text-sm text-muted-foreground"
                  >
                    {tripError ||
                      'No trip data was returned.'}
                  </p>

                  <button
                    type="button"
                    onClick={backToTrips}
                    className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Return to trips
                  </button>
                </div>
              )
            ) : (
              <VehicleMap
                vehicles={trackers}
                selectedVehicleId={
                  selectedTrackerId
                }
                onVehicleSelect={trackerId => {
                  setSelectedTrackerId(trackerId);
                  setIsSheetOpen(true);
                }}
                routePoints={[]}
              />
            )}
          </CardContent>
        </Card>

        {isTripView && currentTrip && (
          <div className="mt-4 lg:hidden">
            <TripSummary
              trip={currentTrip}
              speedUnit={user.speedUnit}
              onBack={backToTrips}
            />
          </div>
        )}
      </div>

      <aside className="hidden w-80 shrink-0 lg:block">
        {isTripView ? (
          currentTrip ? (
            <TripSummary
              trip={currentTrip}
              speedUnit={user.speedUnit}
              onBack={backToTrips}
            />
          ) : (
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                {isCurrentTripLoading
                  ? 'Loading trip information…'
                  : tripError ||
                    'No trip selected.'}
              </CardContent>
            </Card>
          )
        ) : (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>
                Fleet trackers
              </CardTitle>

              <CardDescription>
                {trackers.length} total trackers
              </CardDescription>
            </CardHeader>

            <CardContent>
              <div className="max-h-[calc(100vh-240px)] space-y-2 overflow-y-auto">
                {trackers.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No trackers to show.
                  </p>
                )}

                {trackers.map(tracker => (
                  <button
                    key={tracker.trackerId}
                    type="button"
                    onClick={() => {
                      setSelectedTrackerId(
                        tracker.trackerId
                      );

                      setIsSheetOpen(true);
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      selectedTrackerId ===
                      tracker.trackerId
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-foreground">
                          {tracker.name ||
                            tracker.trackerId}
                        </p>

                        <p className="mt-1 text-xs text-muted-foreground">
                          {tracker.licensePlate ||
                            'No plate'}
                        </p>

                        {tracker.shared && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Shared by{' '}
                            {tracker.customer?.name ||
                              'owner'}
                          </p>
                        )}
                      </div>

                      <Badge
                        variant={statusVariant(
                          tracker.status
                        )}
                        className="text-xs"
                      >
                        {tracker.status}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {tracker.location ? (
                        <>
                          <span>
                            {formatSpeed(
                              tracker.location.speed,
                              user.speedUnit
                            )}
                          </span>

                          <span>
                            {formatLastSeen(
                              tracker.lastSeen
                            )}
                          </span>
                        </>
                      ) : (
                        <span>
                          No GPS position
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </aside>

      <Sheet
        open={isSheetOpen && !isTripView}
        onOpenChange={setIsSheetOpen}
      >
        <SheetContent
          side="bottom"
          className="h-[70vh] max-h-[70vh] overflow-y-auto"
        >
          {selectedTracker ? (
            <>
              <SheetHeader>
                <SheetTitle>
                  {selectedTracker.name ||
                    selectedTracker.trackerId}
                </SheetTitle>

                <SheetDescription>
                  {selectedTracker.licensePlate ||
                    selectedTracker.trackerId}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4 px-2 pb-6">
                <div className="rounded-xl border border-border p-4">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    Device status
                  </p>

                  <Badge
                    variant={statusVariant(
                      selectedTracker.status
                    )}
                  >
                    {selectedTracker.status.toUpperCase()}
                  </Badge>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-primary" />

                    <p className="text-sm font-semibold">
                      Current speed
                    </p>
                  </div>

                  <p className="text-2xl font-bold">
                    {formatSpeed(
                      selectedTracker.location?.speed,
                      user.speedUnit
                    )}
                  </p>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />

                    <p className="text-sm font-semibold">
                      Location
                    </p>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {selectedTracker.location
                      ? `${selectedTracker.location.lat.toFixed(5)}, ${selectedTracker.location.lng.toFixed(5)}`
                      : 'No position received'}
                  </p>

                  {selectedTracker.location?.timestamp && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      GPS time:{' '}
                      {new Date(
                        selectedTracker.location.timestamp
                      ).toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-border p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-primary" />

                    <p className="text-sm font-semibold">
                      Last seen
                    </p>
                  </div>

                  <p className="text-sm">
                    {formatLastSeen(
                      selectedTracker.lastSeen
                    )}
                  </p>
                </div>

                <div className="rounded-xl border border-border p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-primary" />

                    <p className="text-sm font-semibold">
                      Tracker ID
                    </p>
                  </div>

                  <p className="break-all text-sm">
                    {selectedTracker.trackerId}
                  </p>
                </div>

                {user.role === 'ADMIN' &&
                  selectedTracker.customer && (
                    <div className="rounded-xl border border-border p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <User className="h-4 w-4 text-primary" />

                        <p className="text-sm font-semibold">
                          Customer
                        </p>
                      </div>

                      <p className="text-sm">
                        {selectedTracker.customer.name}
                      </p>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedTracker.customer.email}
                      </p>
                    </div>
                  )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Select a tracker to view details.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
