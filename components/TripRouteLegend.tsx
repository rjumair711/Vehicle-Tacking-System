
'use client';

import type {
  TripRouteDetail
} from './TripRouteLayer';

export default function TripRouteLegend({
  trip
}: {
  trip: TripRouteDetail;
}) {
  const status =
    trip.road_match_status || 'gps-only';

  const label =
    status === 'matched'
      ? 'Recorded route matched to roads'
      : status === 'partial'
        ? 'Partially road-matched'
        : 'Recorded GPS path';

  return (
    <div className="rounded-xl border border-border bg-background/95 p-3 text-xs shadow-sm backdrop-blur-sm">
      <p className="mb-2 font-semibold text-foreground">
        {label}
      </p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-1 w-6 rounded-full bg-emerald-600" />
          Road-matched
        </span>

        <span className="inline-flex items-center gap-2">
          <span className="w-6 border-t-[3px] border-dashed border-amber-600" />
          GPS-only
        </span>

        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
          Start
        </span>

        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
          End
        </span>

        {trip.gps_points_count != null && (
          <span>
            {trip.gps_points_count.toLocaleString()}
            {' GPS points'}
          </span>
        )}
      </div>

      <p className="mt-2 text-muted-foreground">
        Uncertain sections may not reflect
        the exact roads traveled.
      </p>
    </div>
  );
}
