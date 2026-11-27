
'use client';

import {
  ROUTE_COLOR,
  type TripRouteDetail
} from './TripRouteLayer';

export default function TripRouteLegend({
  trip,
  crashCount = 0,
  geofenceCount = 0
}: {
  trip: TripRouteDetail;
  crashCount?: number;
  geofenceCount?: number;
}) {
  const status =
    trip.road_match_status || 'gps-only';

  const gpsOnly = status === 'gps-only';
  const matching = Boolean(trip.road_match_pending);

  const label =
    status === 'matched'
      ? 'Recorded route matched to roads'
      : status === 'partial'
        ? 'Partially road-matched'
        : 'Recorded GPS path';

  return (
    <div className="text-xs">
      <p className="mb-2 font-semibold text-foreground">
        {label}
      </p>

      {matching && (
        <p
          role="status"
          className="mb-2 flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1 text-primary"
        >
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Matching the route to roads… the recorded GPS route is shown until it is ready.
        </p>
      )}

      {gpsOnly && !matching && (
        <p className="mb-2 rounded-md bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">
          {trip.road_match_configured === false
            ? "Road matching isn't configured, so the raw GPS trace is shown."
            : 'Road matching is unavailable right now, so the raw GPS trace is shown.'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span
            className="h-1.5 w-6 rounded-full"
            style={{ backgroundColor: ROUTE_COLOR, opacity: 0.9 }}
          />
          {gpsOnly ? 'Recorded GPS route' : 'Route (road-matched)'}
        </span>

        <span className="inline-flex items-center gap-2">
          <span
            className="h-1.5 w-6 rounded-full"
            style={{ backgroundColor: ROUTE_COLOR, opacity: 0.45 }}
          />
          Inferred connection
        </span>

        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
          Start
        </span>

        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
          End
        </span>

        {crashCount > 0 && (
          <span className="inline-flex items-center gap-2 font-medium text-red-600">
            <svg width="14" height="12" viewBox="0 0 34 30" aria-hidden="true">
              <path d="M17 2 L32 28 L2 28 Z" fill="#dc2626" />
              <rect x="15.5" y="10" width="3" height="10" rx="1.5" fill="#fff" />
              <circle cx="17" cy="23.8" r="1.8" fill="#fff" />
            </svg>
            {crashCount === 1 ? '1 crash on this trip' : `${crashCount} crashes on this trip`}
          </span>
        )}

        {geofenceCount > 0 && (
          <span className="inline-flex items-center gap-2 font-medium text-yellow-700 dark:text-yellow-400">
            <svg width="14" height="12" viewBox="0 0 34 30" aria-hidden="true">
              <path d="M17 2 L32 28 L2 28 Z" fill="#facc15" />
              <rect x="15.5" y="10" width="3" height="10" rx="1.5" fill="#1f2937" />
              <circle cx="17" cy="23.8" r="1.8" fill="#1f2937" />
            </svg>
            {geofenceCount === 1 ? '1 geofence alert' : `${geofenceCount} geofence alerts`}
          </span>
        )}

        {trip.gps_points_count != null && (
          <span>
            {trip.gps_points_count.toLocaleString()}
            {' GPS points'}
          </span>
        )}
      </div>

      <p className="mt-2 text-muted-foreground">
        Connections across missing GPS data are estimated.
      </p>
    </div>
  );
}
