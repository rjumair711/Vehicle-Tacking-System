
import 'server-only';

export type Coordinate = [lng: number, lat: number];

export interface GpsSample {
  lng: number;
  lat: number;
  // Unix timestamp in milliseconds
  time?: number;
}

export interface RoadMatchResult {
  road_segments: Coordinate[][];
  gps_segments: Coordinate[][];
  road_match_status: 'matched' | 'partial' | 'gps-only';
  gps_points_count: number;
}

type OsrmResponse = {
  code?: string;
  tracepoints?: Array<unknown | null>;
  matchings?: Array<{
    confidence?: number;
    geometry?: {
      type?: string;
      coordinates?: number[][];
    };
  }>;
};

// Explicit opt-in: avoids sending vehicle coordinates
// to an external routing service by default.
const MATCH_BASE = (
  process.env.OSRM_MATCH_BASE_URL || ''
).replace(/\/$/, '');

const IS_PUBLIC_DEMO = MATCH_BASE.includes(
  'router.project-osrm.org'
);

const MAX_REQUESTS = !MATCH_BASE
  ? 0
  : IS_PUBLIC_DEMO
    ? 3
    : 100;

const CHUNK_SIZE = 85;
const CACHE_MAX = 200;

const cache = new Map<string, {
  expires: number;
  data: RoadMatchResult;
}>();

function haversine(a: GpsSample, b: GpsSample): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;

  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) *
    Math.cos(b.lat * rad) *
    Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function valid(p: GpsSample): boolean {
  return (
    Number.isFinite(p.lng) &&
    Number.isFinite(p.lat) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

function prepareSegments(
  samples: GpsSample[]
): GpsSample[][] {
  const cleaned: GpsSample[] = [];

  for (const point of samples) {
    if (!valid(point)) continue;

    const previous = cleaned[cleaned.length - 1];

    if (previous && haversine(previous, point) < 5) {
      continue;
    }

    cleaned.push(point);
  }

  const segments: GpsSample[][] = [];
  let current: GpsSample[] = [];

  for (const point of cleaned) {
    const previous = current[current.length - 1];

    if (previous) {
      const metres = haversine(previous, point);

      const dt =
        previous.time != null && point.time != null
          ? (point.time - previous.time) / 1000
          : undefined;

      const gap =
        (
          dt != null &&
          (
            dt <= 0 ||
            dt > 180 ||
            metres / dt > 220 / 3.6
          )
        ) ||
        (
          dt == null &&
          metres > 750
        );

      if (gap) {
        if (current.length >= 2) {
          segments.push(current);
        }

        current = [];
      }
    }

    current.push(point);
  }

  if (current.length >= 2) {
    segments.push(current);
  }

  return segments;
}

function gpsOnly(
  segments: GpsSample[][],
  count: number
): RoadMatchResult {
  return {
    road_segments: [],
    gps_segments: segments.map(segment =>
      segment.map(point => [
        point.lng,
        point.lat
      ] as Coordinate)
    ),
    road_match_status: 'gps-only',
    gps_points_count: count
  };
}

async function matchChunk(
  points: GpsSample[]
): Promise<Coordinate[][] | null> {
  if (points.length < 2) return null;

  const coords = points
    .map(point =>
      `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`
    )
    .join(';');

  const params = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    steps: 'false',
    gaps: 'split',
    tidy: 'true'
  });

  const times = points.map(point =>
    point.time == null
      ? null
      : Math.floor(point.time / 1000)
  );

  const validTimes = times.every((value, index) =>
    value !== null &&
    (
      index === 0 ||
      value > (times[index - 1] ?? -Infinity)
    )
  );

  if (validTimes) {
    params.set('timestamps', times.join(';'));
  }

  params.set(
    'radiuses',
    points.map(() => '35').join(';')
  );

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    8000
  );

  try {
    const response = await fetch(
      `${MATCH_BASE}/match/v1/driving/${coords}?${params}`,
      {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/json'
        }
      }
    );

    if (!response.ok) return null;

    const body =
      await response.json() as OsrmResponse;

    if (
      body.code !== 'Ok' ||
      !Array.isArray(body.matchings)
    ) {
      return null;
    }

    // Do not pretend that omitted GPS points
    // were successfully matched.
    if (
      body.tracepoints?.some(point => point === null)
    ) {
      return null;
    }

    if (
      body.matchings.some(
        match =>
          match.confidence != null &&
          match.confidence < 0.5
      )
    ) {
      return null;
    }

    const lines = body.matchings
      .filter(match =>
        match.geometry?.type === 'LineString' &&
        (match.geometry.coordinates?.length || 0) >= 2
      )
      .map(match =>
        match.geometry!.coordinates!
          .filter(point =>
            Array.isArray(point) &&
            point.length >= 2 &&
            Number.isFinite(point[0]) &&
            Number.isFinite(point[1])
          )
          .map(point => [
            point[0],
            point[1]
          ] as Coordinate)
      )
      .filter(line => line.length >= 2);

    return lines.length ? lines : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function matchRecordedRoute(
  samples: GpsSample[],
  cacheKey: string,
  isLive = false
): Promise<RoadMatchResult> {
  const parts = prepareSegments(samples);
  const fallback = gpsOnly(parts, samples.length);

  if (!parts.length) return fallback;

  const cached = cache.get(cacheKey);

  if (
    cached &&
    cached.expires > Date.now()
  ) {
    return cached.data;
  }

  const chunks: GpsSample[][] = [];

  for (const part of parts) {
    for (
      let offset = 0;
      offset < part.length - 1;
      offset += CHUNK_SIZE - 1
    ) {
      const chunk = part.slice(
        offset,
        offset + CHUNK_SIZE
      );

      if (chunk.length >= 2) {
        chunks.push(chunk);
      }
    }
  }

  const results:
    Array<Coordinate[][] | null> =
      Array(chunks.length).fill(null);

  const deadline = Date.now() + 12000;

  let next = 0;

  const workerCount = Math.min(
    4,
    MAX_REQUESTS,
    chunks.length
  );

  await Promise.all(
    Array.from(
      { length: workerCount },
      async () => {
        while (true) {
          const index = next++;

          if (
            index >= chunks.length ||
            index >= MAX_REQUESTS ||
            Date.now() > deadline
          ) {
            return;
          }

          results[index] =
            await matchChunk(chunks[index]);
        }
      }
    )
  );

  let matched = 0;
  let unmatched = 0;

  const roadSegments: Coordinate[][] = [];
  const gpsSegments: Coordinate[][] = [];

  chunks.forEach((chunk, index) => {
    const lines = results[index];

    if (lines) {
      matched++;
      roadSegments.push(...lines);
    } else {
      unmatched++;

      gpsSegments.push(
        chunk.map(point => [
          point.lng,
          point.lat
        ] as Coordinate)
      );
    }
  });

  const result: RoadMatchResult = {
    road_segments: roadSegments,
    gps_segments: gpsSegments,
    road_match_status:
      matched === 0
        ? 'gps-only'
        : unmatched === 0
          ? 'matched'
          : 'partial',
    gps_points_count: samples.length
  };

  cache.set(cacheKey, {
    expires:
      Date.now() +
      (isLive ? 30000 : 30 * 60 * 1000),
    data: result
  });

  if (cache.size > CACHE_MAX) {
    const firstKey = cache.keys().next().value;

    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }

  return result;
}

export function legacyGeometrySamples(
  geojson?: string | null
): GpsSample[] {
  if (!geojson) return [];

  try {
    const obj = JSON.parse(geojson) as {
      type?: string;
      coordinates?: unknown;
    };

    if (
      obj.type !== 'LineString' ||
      !Array.isArray(obj.coordinates)
    ) {
      return [];
    }

    return obj.coordinates.flatMap(item =>
      Array.isArray(item) &&
      typeof item[0] === 'number' &&
      typeof item[1] === 'number'
        ? [{
            lng: item[0],
            lat: item[1]
          }]
        : []
    );
  } catch {
    return [];
  }
}
