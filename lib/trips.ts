
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Session } from '@/lib/auth';
import { ownerFilter } from '@/lib/trackers';
import {
  legacyGeometrySamples,
  matchRecordedRoute,
  type GpsSample
} from '@/lib/trip-road-match';

export const TRIP_TIME_ZONE =
  process.env.TRIP_TIME_ZONE || 'Asia/Karachi';

export const MOVING_SPEED_KMH = 3;
export const MAX_VALID_SPEED_KMH = 220;

// Handle UTC-stored TIMESTAMP and TIMESTAMPTZ columns.
const localDay = (column: Prisma.Sql) =>
  Prisma.sql`
    (
      CASE
        WHEN pg_typeof(${column})::text =
          'timestamp with time zone'
        THEN (
          ${column} AT TIME ZONE ${TRIP_TIME_ZONE}
        )::date
        ELSE (
          (
            ${column} AT TIME ZONE 'UTC'
          ) AT TIME ZONE ${TRIP_TIME_ZONE}
        )::date
      END
    )
  `;

const utcMoment = (column: Prisma.Sql) =>
  Prisma.sql`
    (
      CASE
        WHEN pg_typeof(${column})::text =
          'timestamp with time zone'
        THEN ${column}::timestamptz
        ELSE (
          ${column} AT TIME ZONE 'UTC'
        )
      END
    )
  `;

const today = Prisma.sql`
  (NOW() AT TIME ZONE ${TRIP_TIME_ZONE})::date
`;

type DayChanged = {
  tracker_id: string;
  trip_date: string;
  point_count: number;
};

// Archive completed-day GPS observations and rebuild
// changed trips from all archived timestamped samples.
export async function rollUpFinishedDays():
  Promise<number> {
  return prisma.$transaction(async tx => {
    const changed = await tx.$queryRaw<
      DayChanged[]
    >`
      WITH inserted AS (
        INSERT INTO trip_route_points (
          tracker_id,
          trip_date,
          recorded_at,
          speed_kmh,
          location
        )
        SELECT
          lp.tracker_id,
          ${localDay(Prisma.sql`lp.recorded_at`)},
          ${utcMoment(Prisma.sql`lp.recorded_at`)},
          lp.speed::double precision,
          lp.location
        FROM location_points lp
        WHERE
          ${localDay(Prisma.sql`lp.recorded_at`)}
            < ${today}
          AND lp.speed >= ${MOVING_SPEED_KMH}
          AND lp.speed <= ${MAX_VALID_SPEED_KMH}
          AND lp.location IS NOT NULL
        ON CONFLICT (tracker_id, recorded_at)
        DO NOTHING
        RETURNING tracker_id, trip_date
      )
      SELECT
        tracker_id,
        trip_date::text AS trip_date,
        COUNT(*)::int AS point_count
      FROM inserted
      GROUP BY tracker_id, trip_date
    `;

    // Process changed days in manageable batches.
    for (
      let offset = 0;
      offset < changed.length;
      offset += 100
    ) {
      const batch = changed.slice(
        offset,
        offset + 100
      );

      const keys = Prisma.join(
        batch.map(group =>
          Prisma.sql`(
            ${group.tracker_id},
            ${group.trip_date}::date
          )`
        )
      );

      await tx.$executeRaw`
        WITH affected (
          tracker_id,
          trip_date
        ) AS (
          VALUES ${keys}
        ),

        points AS (
          SELECT
            p.tracker_id,
            p.trip_date,
            p.recorded_at,
            p.speed_kmh,
            p.location,

            LAG(p.recorded_at) OVER w
              AS prev_at,

            LAG(p.location) OVER w
              AS prev_location

          FROM trip_route_points p
          JOIN affected a
            ON a.tracker_id = p.tracker_id
           AND a.trip_date = p.trip_date

          WINDOW w AS (
            PARTITION BY
              p.tracker_id,
              p.trip_date
            ORDER BY p.recorded_at
          )
        ),

        measured AS (
          SELECT
            *,

            EXTRACT(
              EPOCH FROM (
                recorded_at - prev_at
              )
            ) AS seconds_elapsed,

            CASE
              WHEN prev_location IS NOT NULL
              THEN ST_Distance(
                prev_location::geography,
                location::geography
              )
              ELSE 0
            END AS metres

          FROM points
        ),

        aggregated AS (
          SELECT
            tracker_id,
            trip_date,

            MIN(recorded_at) AS start_time,
            MAX(recorded_at) AS end_time,

            AVG(speed_kmh) AS average_speed,
            MAX(speed_kmh) AS max_speed,

            ST_MakeLine(
              location ORDER BY recorded_at
            ) AS route,

            SUM(
              CASE
                WHEN seconds_elapsed > 0
                  AND seconds_elapsed <= 180
                  AND metres <= (
                    seconds_elapsed *
                    ${MAX_VALID_SPEED_KMH} / 3.6
                  )
                THEN metres
                ELSE 0
              END
            ) / 1000.0 AS total_distance,

            COUNT(*) AS sample_count

          FROM measured

          GROUP BY
            tracker_id,
            trip_date

          HAVING COUNT(*) >= 2
        )

        INSERT INTO trip_history (
          tracker_id,
          trip_date,
          start_time,
          end_time,
          total_distance,
          average_speed,
          max_speed,
          route,
          route_archive_v2
        )

        SELECT
          tracker_id,
          trip_date,
          start_time,
          end_time,
          total_distance,
          average_speed,
          max_speed,
          route,
          TRUE

        FROM aggregated

        ON CONFLICT (
          tracker_id,
          trip_date
        )
        DO UPDATE SET
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          total_distance = EXCLUDED.total_distance,
          average_speed = EXCLUDED.average_speed,
          max_speed = EXCLUDED.max_speed,
          route = EXCLUDED.route

        WHERE trip_history.route_archive_v2 = TRUE
      `;
    }

    // Remove old raw records only if they are
    // non-moving/invalid or have an archived copy.
    await tx.$executeRaw`
      DELETE FROM location_points lp

      WHERE
        ${localDay(Prisma.sql`lp.recorded_at`)}
          < ${today}

        AND (
          lp.speed IS NULL
          OR lp.speed < ${MOVING_SPEED_KMH}
          OR lp.speed > ${MAX_VALID_SPEED_KMH}
          OR lp.location IS NULL

          OR EXISTS (
            SELECT 1
            FROM trip_route_points p

            WHERE
              p.tracker_id = lp.tracker_id
              AND p.recorded_at =
                ${utcMoment(
                  Prisma.sql`lp.recorded_at`
                )}
          )
        )
    `;

    return changed.length;
  }, {
    maxWait: 10000,
    timeout: 60000
  });
}

export interface TripRow {
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
  route_geojson: string | null;

  archived_v2: boolean;
}

function tripsQuery(
  session: Session,
  withRoute: boolean,
  tripId?: string
) {
  const route = withRoute
    ? Prisma.sql`
        ST_AsGeoJSON(a.route)
        AS route_geojson
      `
    : Prisma.sql`
        NULL::text AS route_geojson
      `;

  const onlyTrip = tripId
    ? Prisma.sql`a.trip_id = ${tripId}`
    : Prisma.sql`TRUE`;

  return prisma.$queryRaw<TripRow[]>`
    WITH live_points AS (
      SELECT
        lp.tracker_id,
        lp.recorded_at,
        lp.location,
        lp.speed,

        ${localDay(
          Prisma.sql`lp.recorded_at`
        )} AS trip_date,

        LAG(lp.recorded_at) OVER w
          AS prev_at,

        LAG(lp.location) OVER w
          AS prev_location

      FROM location_points lp

      WHERE
        ${localDay(
          Prisma.sql`lp.recorded_at`
        )} = ${today}

        AND lp.speed >= ${MOVING_SPEED_KMH}
        AND lp.speed <= ${MAX_VALID_SPEED_KMH}
        AND lp.location IS NOT NULL

      WINDOW w AS (
        PARTITION BY lp.tracker_id
        ORDER BY lp.recorded_at
      )
    ),

    live_measured AS (
      SELECT
        *,

        EXTRACT(
          EPOCH FROM (
            recorded_at - prev_at
          )
        ) AS seconds_elapsed,

        CASE
          WHEN prev_location IS NOT NULL
          THEN ST_Distance(
            prev_location::geography,
            location::geography
          )
          ELSE 0
        END AS metres

      FROM live_points
    ),

    live AS (
      SELECT
        tracker_id,
        trip_date,

        MIN(recorded_at) AS start_time,
        MAX(recorded_at) AS end_time,

        AVG(speed)::double precision
          AS average_speed,

        MAX(speed)::double precision
          AS max_speed,

        SUM(
          CASE
            WHEN seconds_elapsed > 0
              AND seconds_elapsed <= 180
              AND metres <= (
                seconds_elapsed *
                ${MAX_VALID_SPEED_KMH} / 3.6
              )
            THEN metres
            ELSE 0
          END
        ) / 1000.0 AS total_distance,

        ST_MakeLine(
          location ORDER BY recorded_at
        ) AS route

      FROM live_measured

      GROUP BY
        tracker_id,
        trip_date

      HAVING COUNT(*) >= 2
    ),

    all_trips AS (
      SELECT
        th.trip_id::text AS trip_id,
        th.tracker_id,
        th.trip_date,
        th.start_time,
        th.end_time,
        th.total_distance,
        th.average_speed,
        th.max_speed,
        th.route,

        'completed'::text AS status,

        th.route_archive_v2 AS archived_v2

      FROM trip_history th

      UNION ALL

      SELECT
        'live-' || l.tracker_id,
        l.tracker_id,
        l.trip_date,
        l.start_time,
        l.end_time,
        l.total_distance,
        l.average_speed,
        l.max_speed,
        l.route,

        'active'::text,
        FALSE AS archived_v2

      FROM live l
    )

    SELECT
      a.trip_id,
      a.tracker_id,

      t.name,
      t.license_plate,

      a.trip_date,
      a.start_time,
      a.end_time,

      a.total_distance,
      a.average_speed,
      a.max_speed,
      a.status,
      a.archived_v2,

      ST_AsGeoJSON(
        ST_StartPoint(a.route)
      ) AS start_point,

      ST_AsGeoJSON(
        ST_EndPoint(a.route)
      ) AS end_point,

      ${route}

    FROM all_trips a

    JOIN trackers t
      ON t.tracker_id = a.tracker_id

    WHERE
      ${ownerFilter(session)}
      AND ${onlyTrip}

    ORDER BY a.start_time DESC

    LIMIT ${tripId ? 1 : 500}
  `;
}

// List trips without running external road matching.
export async function listTrips(
  session: Session
): Promise<TripRow[]> {
  if (
    process.env.TRIP_ROLLUP_ON_READ !== 'false'
  ) {
    await rollUpFinishedDays();
  }

  return tripsQuery(session, false);
}

async function loadMovementPoints(
  trip: TripRow
): Promise<GpsSample[]> {
  if (
    trip.status === 'completed' &&
    !trip.archived_v2
  ) {
    // Legacy route with no original timestamps.
    return legacyGeometrySamples(
      trip.route_geojson
    );
  }

  type PointRow = {
    lng: number;
    lat: number;
    time_s: number;
  };

  let rows: PointRow[];

  if (trip.status === 'active') {
    rows = await prisma.$queryRaw<PointRow[]>`
      SELECT
        ST_X(lp.location)::double precision
          AS lng,

        ST_Y(lp.location)::double precision
          AS lat,

        EXTRACT(
          EPOCH FROM
          ${utcMoment(
            Prisma.sql`lp.recorded_at`
          )}
        )::double precision AS time_s

      FROM location_points lp

      WHERE
        lp.tracker_id = ${trip.tracker_id}

        AND ${localDay(
          Prisma.sql`lp.recorded_at`
        )} = ${today}

        AND lp.speed >= ${MOVING_SPEED_KMH}
        AND lp.speed <= ${MAX_VALID_SPEED_KMH}
        AND lp.location IS NOT NULL

      ORDER BY lp.recorded_at ASC
    `;
  } else {
    const day = trip.trip_date
      .toISOString()
      .slice(0, 10);

    rows = await prisma.$queryRaw<PointRow[]>`
      SELECT
        ST_X(p.location)::double precision
          AS lng,

        ST_Y(p.location)::double precision
          AS lat,

        EXTRACT(
          EPOCH FROM p.recorded_at
        )::double precision AS time_s

      FROM trip_route_points p

      WHERE
        p.tracker_id = ${trip.tracker_id}
        AND p.trip_date = ${day}::date

      ORDER BY p.recorded_at ASC
    `;
  }

  return rows.map(point => ({
    lng: Number(point.lng),
    lat: Number(point.lat),
    time: Number(point.time_s) * 1000
  }));
}

// Retrieve only a trip the user is authorized to view.
export async function getTrip(
  session: Session,
  tripId: string
) {
  const rows = await tripsQuery(
    session,
    true,
    tripId
  );

  const trip = rows[0];

  if (!trip) return null;

  const points = await loadMovementPoints(trip);

  const signature = [
    trip.tracker_id,
    trip.trip_date.toISOString(),
    trip.end_time.toISOString(),
    points.length
  ].join(':');

  const matchedRoute = await matchRecordedRoute(
    points,
    signature,
    trip.status === 'active'
  );

  return {
    ...trip,
    ...matchedRoute
  };
}
