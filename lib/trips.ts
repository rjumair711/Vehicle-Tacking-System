import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Session } from '@/lib/auth';
import { ownerFilter } from '@/lib/trackers';

// One trip per tracker per local day. Days are cut in this time zone
// (recorded_at itself is stored in UTC).
export const TRIP_TIME_ZONE = process.env.TRIP_TIME_ZONE || 'Asia/Karachi';

// A parked tracker still reports every 5 s and GPS jitter would add up to
// kilometres, so only points at or above this speed form the route. It
// matches the firmware's own "parked" limit (3 km/h).
export const MOVING_SPEED_KMH = 3;

const localDay = (column: Prisma.Sql) =>
  Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${TRIP_TIME_ZONE})::date`;
const today = Prisma.sql`(NOW() AT TIME ZONE ${TRIP_TIME_ZONE})::date`;

// Turns every finished day's raw points into a trip_history row and removes
// those points, in one statement. Late backlog points for a day that already
// has a trip are merged into it. Safe to call at any time.
export async function rollUpFinishedDays(): Promise<number> {
  return prisma.$executeRaw`
    WITH finished AS (
      DELETE FROM location_points
      WHERE ${localDay(Prisma.sql`recorded_at`)} < ${today}
      RETURNING tracker_id, speed, recorded_at, location
    ),
    daily AS (
      SELECT
        tracker_id,
        ${localDay(Prisma.sql`recorded_at`)} AS trip_date,
        MIN(recorded_at) AS start_time,
        MAX(recorded_at) AS end_time,
        AVG(speed) AS average_speed,
        MAX(speed) AS max_speed,
        ST_MakeLine(location ORDER BY recorded_at) AS route
      FROM finished
      WHERE speed >= ${MOVING_SPEED_KMH} AND location IS NOT NULL
      GROUP BY 1, 2
      HAVING COUNT(*) >= 2
    )
    INSERT INTO trip_history
      (tracker_id, trip_date, start_time, end_time, total_distance, average_speed, max_speed, route)
    SELECT
      tracker_id, trip_date, start_time, end_time,
      ST_Length(route::geography) / 1000.0, average_speed, max_speed, route
    FROM daily
    ON CONFLICT (tracker_id, trip_date) DO UPDATE SET
      start_time = LEAST(trip_history.start_time, EXCLUDED.start_time),
      end_time = GREATEST(trip_history.end_time, EXCLUDED.end_time),
      total_distance = COALESCE(trip_history.total_distance, 0) + EXCLUDED.total_distance,
      average_speed = (COALESCE(trip_history.average_speed, 0) + EXCLUDED.average_speed) / 2,
      max_speed = GREATEST(COALESCE(trip_history.max_speed, 0), EXCLUDED.max_speed),
      route = CASE
        WHEN trip_history.route IS NULL THEN EXCLUDED.route
        WHEN EXCLUDED.start_time >= trip_history.end_time THEN ST_MakeLine(trip_history.route, EXCLUDED.route)
        ELSE ST_MakeLine(EXCLUDED.route, trip_history.route)
      END
  `;
}

interface TripRow {
  trip_id: string;
  tracker_id: string;
  name: string | null;
  license_plate: string | null;
  trip_date: Date;
  start_time: Date;
  end_time: Date;
  total_distance: number | null;
  average_speed: number | null;
  max_speed: number | null;
  status: 'active' | 'completed';
  start_point: string | null;
  end_point: string | null;
  route_geojson?: string | null;
}

// Completed days come from trip_history; today's trip is built live from the
// points received so far and has the id "live-<tracker id>".
function tripsQuery(session: Session, withRoute: boolean, tripId?: string) {
  const route = withRoute
    ? Prisma.sql`ST_AsGeoJSON(route) AS route_geojson`
    : Prisma.sql`NULL::text AS route_geojson`;
  const onlyTrip = tripId ? Prisma.sql`trip_id = ${tripId}` : Prisma.sql`TRUE`;

  return prisma.$queryRaw<TripRow[]>`
    WITH live AS (
      SELECT
        lp.tracker_id,
        ${localDay(Prisma.sql`lp.recorded_at`)} AS trip_date,
        MIN(lp.recorded_at) AS start_time,
        MAX(lp.recorded_at) AS end_time,
        AVG(lp.speed) AS average_speed,
        MAX(lp.speed) AS max_speed,
        ST_MakeLine(lp.location ORDER BY lp.recorded_at) AS route
      FROM location_points lp
      WHERE lp.speed >= ${MOVING_SPEED_KMH} AND lp.location IS NOT NULL
      GROUP BY 1, 2
      HAVING COUNT(*) >= 2
    ),
    all_trips AS (
      SELECT
        th.trip_id::text AS trip_id, th.tracker_id, th.trip_date, th.start_time, th.end_time,
        th.total_distance, th.average_speed, th.max_speed, th.route, 'completed' AS status
      FROM trip_history th
      UNION ALL
      SELECT
        'live-' || live.tracker_id, live.tracker_id, live.trip_date, live.start_time, live.end_time,
        ST_Length(live.route::geography) / 1000.0, live.average_speed, live.max_speed, live.route, 'active'
      FROM live
    )
    SELECT
      a.trip_id, a.tracker_id, t.name, t.license_plate,
      a.trip_date, a.start_time, a.end_time,
      a.total_distance, a.average_speed, a.max_speed, a.status,
      ST_AsGeoJSON(ST_StartPoint(a.route)) AS start_point,
      ST_AsGeoJSON(ST_EndPoint(a.route)) AS end_point,
      ${route}
    FROM all_trips a
    JOIN trackers t ON t.tracker_id = a.tracker_id
    WHERE ${ownerFilter(session)} AND ${onlyTrip}
    ORDER BY a.start_time DESC
    LIMIT 500
  `;
}

export async function listTrips(session: Session) {
  await rollUpFinishedDays();
  return tripsQuery(session, false);
}

export async function getTrip(session: Session, tripId: string) {
  const rows = await tripsQuery(session, true, tripId);
  return rows[0] ?? null;
}
