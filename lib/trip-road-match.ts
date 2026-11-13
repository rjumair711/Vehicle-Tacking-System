
import 'server-only';

import { createHash } from 'node:crypto';

import {
  OSRM_BASE_URL,
  OSRM_IS_PUBLIC,
  osrmGet
} from '@/lib/osrm';

export type Coordinate = [lng: number, lat: number];

// Inclusive vertex index range into route_line.
export type IndexRange = [start: number, end: number];

export interface GpsSample {
  lng: number;
  lat: number;
  // Unix timestamp in milliseconds
  time?: number;
  // km/h, when the tracker reported it
  speed?: number;
}

export type RoadMatchStatus =
  | 'matched'
  | 'partial'
  | 'gps-only';

export interface RoadMatchResult {
  // One continuous, ordered polyline [lng, lat].
  route_line: Coordinate[];

  // Parts of route_line that were NOT observed on a
  // matched road: routed or straight connectors across
  // missing GPS data / unmatched chunks.
  inferred_ranges: IndexRange[];

  // Kept for older clients.
  road_segments: Coordinate[][];
  gps_segments: Coordinate[][];

  road_match_status: RoadMatchStatus;
  road_match_configured: boolean;
  gps_points_count: number;
}

// Bump when the algorithm changes so persisted
// matches are recomputed.
export const ROUTE_MATCH_VERSION = 2;

type OsrmMatchResponse = {
  code?: string;
  message?: string;
  matchings?: Array<{
    confidence?: number;
    geometry?: {
      type?: string;
      coordinates?: number[][];
    };
  }>;
};

type OsrmRouteResponse = {
  code?: string;
  routes?: Array<{
    distance?: number;
    geometry?: {
      type?: string;
      coordinates?: number[][];
    };
  }>;
};

// ---------------------------------------------------------------------------
// Configuration (server-side only)
// ---------------------------------------------------------------------------

const DEBUG =
  process.env.TRIP_MATCH_DEBUG === 'true' ||
  process.env.TRIP_MATCH_DEBUG === '1';

function debug(...args: unknown[]) {
  if (DEBUG) console.log('[trip-match]', ...args);
}

// Rules for which server is used (OSRM_MATCH_BASE_URL,
// ALLOW_PUBLIC_OSRM) live in lib/osrm.ts.
const BASE_URL = OSRM_BASE_URL;
const IS_PUBLIC_DEMO = OSRM_IS_PUBLIC;

// Upper bound on OSRM calls per trip
// (match chunks + retries + bridges).
const MAX_REQUESTS = !BASE_URL
  ? 0
  : IS_PUBLIC_DEMO
    ? 60
    : 300;

// The public server is throttled to 1 request/s in
// lib/osrm.ts, so parallel workers gain nothing there.
const CONCURRENCY = IS_PUBLIC_DEMO ? 1 : 4;
const REQUEST_TIMEOUT_MS = 8000;

// app/api/trips sets maxDuration = 60; leave ~10 s for
// the database and the response.
const TOTAL_BUDGET_MS = 50_000;

// Stop calling a server that keeps rate-limiting or
// failing (each failure already had one retry).
const MAX_TRANSIENT_FAILURES = 2;

// In-memory cache of today's active trip.
const LIVE_CACHE_MS = 5 * 60_000;

// Must stay under osrm-routed --max-matching-size
// (default 100). The public demo only accepts 10.
const CHUNK_SIZE = Math.max(
  4,
  Math.min(
    100,
    Number(process.env.OSRM_MAX_MATCH_COORDS) ||
      (IS_PUBLIC_DEMO ? 10 : 85)
  )
);

const CHUNK_OVERLAP = CHUNK_SIZE >= 40 ? 4 : 2;

const RADIUS_DEFAULT_M = 50;
const RADIUS_RETRY_M = 90;

// osrm-routed rejects radiuses above its
// --max-matching-radius with "TooBig". The public demo
// allows about 40 m. Self-hosted servers default to no
// limit; set OSRM_MAX_MATCH_RADIUS if yours has one.
let radiusCap = Number(process.env.OSRM_MAX_MATCH_RADIUS) ||
  (IS_PUBLIC_DEMO ? 40 : Infinity);

const FALLBACK_RADIUS_CAP = 40;

const MAX_SPEED_KMH = 220;
const STATIONARY_SPEED_KMH = 3;
const STATIONARY_RADIUS_M = 25;
// The public server takes only 10 points per request at
// 1 request/s, so sample more sparsely there to keep a
// whole day's trip inside the time budget.
const THIN_MIN_SPACING_M = IS_PUBLIC_DEMO ? 30 : 18;
const THIN_HEADING_DEG = 30;

// Split the trace where GPS data is missing.
const GAP_SECONDS = 180;
const GAP_METRES = 1000;

const BRIDGE_MAX_STRAIGHT_M = 2000;
const BRIDGE_MAX_DETOUR = 3;

const CACHE_MAX = 200;

export function roadMatchingConfigured(): boolean {
  return BASE_URL !== '';
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;

function distance(
  a: { lng: number; lat: number } | Coordinate,
  b: { lng: number; lat: number } | Coordinate
): number {
  const [aLng, aLat] = Array.isArray(a)
    ? a
    : [a.lng, a.lat];
  const [bLng, bLat] = Array.isArray(b)
    ? b
    : [b.lng, b.lat];

  const dLat = (bLat - aLat) * RAD;
  const dLng = (bLng - aLng) * RAD;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * RAD) *
      Math.cos(bLat * RAD) *
      Math.sin(dLng / 2) ** 2;

  return 2 * 6371008.8 *
    Math.asin(Math.min(1, Math.sqrt(x)));
}

function bearing(a: GpsSample, b: GpsSample): number {
  const y =
    Math.sin((b.lng - a.lng) * RAD) *
    Math.cos(b.lat * RAD);
  const x =
    Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
    Math.sin(a.lat * RAD) *
      Math.cos(b.lat * RAD) *
      Math.cos((b.lng - a.lng) * RAD);

  return (Math.atan2(y, x) / RAD + 360) % 360;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function lineLength(line: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    total += distance(line[i - 1], line[i]);
  }
  return total;
}

// Closest point to p on segment a-b (planar
// approximation, fine at city scale).
function projectOnSegment(
  p: Coordinate,
  a: Coordinate,
  b: Coordinate
): { point: Coordinate; t: number } {
  const k = Math.cos(p[1] * RAD);
  const ax = a[0] * k;
  const bx = b[0] * k;
  const px = p[0] * k;
  const dx = bx - ax;
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;

  const t = len2 === 0
    ? 0
    : Math.max(
        0,
        Math.min(
          1,
          ((px - ax) * dx + (p[1] - a[1]) * dy) / len2
        )
      );

  return {
    point: [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t
    ],
    t
  };
}

const toCoord = (p: GpsSample): Coordinate =>
  [p.lng, p.lat];

function cleanCoords(raw: number[][] | undefined): Coordinate[] {
  return (raw || [])
    .filter(point =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
    )
    .map(point => [point[0], point[1]] as Coordinate);
}

// ---------------------------------------------------------------------------
// Step 2: prepare the input trace
// ---------------------------------------------------------------------------

function valid(p: GpsSample): boolean {
  return (
    Number.isFinite(p.lng) &&
    Number.isFinite(p.lat) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

const seconds = (p: GpsSample) =>
  p.time == null ? null : Math.floor(p.time / 1000);

// Sort, drop invalid / duplicate / impossible fixes and
// collapse stationary jitter.
function cleanTrace(samples: GpsSample[]): GpsSample[] {
  let points = samples.filter(valid);

  if (points.every(p => p.time != null)) {
    points = points
      .slice()
      .sort((a, b) => a.time! - b.time!);
  }

  const out: GpsSample[] = [];
  let rejectedInRow = 0;

  for (const p of points) {
    const prev = out[out.length - 1];

    if (!prev) {
      out.push(p);
      continue;
    }

    const metres = distance(prev, p);
    const ps = seconds(prev);
    const cs = seconds(p);
    const dt = ps != null && cs != null ? cs - ps : null;

    // Same second (OSRM needs strictly increasing
    // timestamps) or the same position.
    if ((dt != null && dt <= 0) || metres < 1) continue;

    if (
      dt != null &&
      dt <= GAP_SECONDS &&
      metres / dt > MAX_SPEED_KMH / 3.6
    ) {
      // If several fixes in a row are "impossible",
      // the previous kept fix was the outlier.
      rejectedInRow++;
      if (rejectedInRow >= 3 && out.length > 1) {
        out.pop();
        out.push(p);
        rejectedInRow = 0;
      }
      continue;
    }

    rejectedInRow = 0;

    const slow =
      (p.speed != null && p.speed < STATIONARY_SPEED_KMH) ||
      (dt != null && metres / dt < STATIONARY_SPEED_KMH / 3.6);

    if (slow && metres < STATIONARY_RADIUS_M) continue;

    out.push(p);
  }

  return out;
}

// Split where GPS data is missing.
function splitAtGaps(points: GpsSample[]): GpsSample[][] {
  const segments: GpsSample[][] = [];
  let current: GpsSample[] = [];

  for (const p of points) {
    const prev = current[current.length - 1];

    if (prev) {
      const ps = seconds(prev);
      const cs = seconds(p);
      const dt = ps != null && cs != null ? cs - ps : null;
      const metres = distance(prev, p);

      if (
        (dt != null && dt > GAP_SECONDS) ||
        metres > GAP_METRES
      ) {
        segments.push(current);
        current = [];
      }
    }

    current.push(p);
  }

  if (current.length) segments.push(current);

  return segments;
}

// Keep samples >= ~18 m apart, plus the endpoints and
// sharp turns.
function thin(segment: GpsSample[]): GpsSample[] {
  if (segment.length <= 2) return segment;

  const kept: GpsSample[] = [segment[0]];

  for (let i = 1; i < segment.length - 1; i++) {
    const last = kept[kept.length - 1];
    const p = segment[i];
    const next = segment[i + 1];
    const d = distance(last, p);

    if (d >= THIN_MIN_SPACING_M) {
      kept.push(p);
      continue;
    }

    if (
      d >= 5 &&
      distance(p, next) >= 5 &&
      angleDiff(bearing(last, p), bearing(p, next)) >
        THIN_HEADING_DEG
    ) {
      kept.push(p);
    }
  }

  const last = segment[segment.length - 1];
  const tail = kept[kept.length - 1];

  if (tail !== last) {
    // Avoid two nearly identical final points.
    if (kept.length > 1 && distance(tail, last) < 5) {
      kept[kept.length - 1] = last;
    } else {
      kept.push(last);
    }
  }

  return kept;
}

function chunk(segment: GpsSample[]): GpsSample[][] {
  if (segment.length <= CHUNK_SIZE) return [segment];

  const chunks: GpsSample[][] = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;

  for (let offset = 0; ; offset += step) {
    const part = segment.slice(offset, offset + CHUNK_SIZE);
    chunks.push(part);
    if (offset + CHUNK_SIZE >= segment.length) break;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// OSRM calls
// ---------------------------------------------------------------------------

interface Budget {
  requests: number;
  deadline: number;
  transientFailures: number;
  // Set when a call was skipped for lack of time,
  // requests or a failing server.
  exhausted: boolean;
}

function canRequest(budget: Budget): boolean {
  const ok =
    budget.requests < MAX_REQUESTS &&
    budget.transientFailures < MAX_TRANSIENT_FAILURES &&
    Date.now() < budget.deadline;

  if (!ok) budget.exhausted = true;
  return ok;
}

// Results of individual OSRM calls, reused across views,
// so a trip that ran out of time resumes instead of
// starting over (on the same server instance).
const callCache = new Map<string, unknown>();
const CALL_CACHE_MAX = 5000;

async function osrmFetch<T>(
  service: 'match' | 'route',
  coords: Coordinate[],
  params: URLSearchParams,
  budget: Budget,
  label: string
): Promise<{ status: number; body: T | null }> {

  const path = coords
    .map(([lng, lat]) =>
      `${lng.toFixed(6)},${lat.toFixed(6)}`
    )
    .join(';');

  // Never log coordinates.
  const safeParams = new URLSearchParams(params);
  for (const key of ['timestamps', 'radiuses']) {
    const value = safeParams.get(key);
    if (value) {
      safeParams.set(
        key,
        `<${value.split(';').length} values>`
      );
    }
  }

  const loggedUrl =
    `${BASE_URL}/${service}/v1/driving/<${coords.length} coords>?${safeParams}`;

  const url = `${service}/v1/driving/${path}?${params}`;
  const key = createHash('sha1').update(url).digest('base64');

  if (callCache.has(key)) {
    debug(label, loggedUrl, 'cached');
    return { status: 200, body: callCache.get(key) as T };
  }

  budget.requests++;

  // Throttled, User-Agent, one retry on 429/5xx.
  const { status, body, transient } = await osrmGet<T>(url, {
    deadline: budget.deadline,
    timeoutMs: REQUEST_TIMEOUT_MS
  });

  debug(label, loggedUrl, 'HTTP', status || 'failed/timeout');

  if (transient) {
    budget.transientFailures++;
    budget.exhausted = true;
    return { status: 0, body: null };
  }

  // Cache definite answers (Ok, NoMatch, ...), not outages.
  if (status > 0 && body) {
    callCache.set(key, body);
    if (callCache.size > CALL_CACHE_MAX) {
      const oldest = callCache.keys().next().value;
      if (oldest !== undefined) callCache.delete(oldest);
    }
  }

  return { status, body };
}

interface ChunkMatch {
  lines: Coordinate[][];
  transient: boolean;
}

async function matchChunkOnce(
  points: GpsSample[],
  radius: number,
  budget: Budget,
  label: string
): Promise<ChunkMatch> {
  const params = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    steps: 'false',
    tidy: 'true',
    gaps: 'ignore'
  });

  // Strictly increasing whole seconds are guaranteed by
  // cleanTrace(); only send them when every point has one.
  const times = points.map(seconds);
  if (times.every(t => t != null)) {
    params.set('timestamps', times.join(';'));
  }

  params.set(
    'radiuses',
    points.map(() => String(radius)).join(';')
  );

  const { status, body } = await osrmFetch<OsrmMatchResponse>(
    'match',
    points.map(toCoord),
    params,
    budget,
    label
  );

  const matchings = body?.matchings || [];

  debug(
    label,
    `radius=${radius}m`,
    'code',
    body?.code ?? '(none)',
    'matchings',
    matchings.length,
    'confidence',
    matchings
      .map(m => m.confidence?.toFixed(2) ?? '?')
      .join(',')
  );

  if (status === 0 || status === 429 || status >= 500) {
    return { lines: [], transient: true };
  }

  if (
    body?.code === 'TooBig' &&
    /radius/i.test(body.message || '') &&
    radius > FALLBACK_RADIUS_CAP
  ) {
    // Server has a lower --max-matching-radius.
    console.warn(
      `[trip-match] OSRM rejected a ${radius} m radius; capping at ${FALLBACK_RADIUS_CAP} m. Set OSRM_MAX_MATCH_RADIUS to silence this.`
    );
    radiusCap = FALLBACK_RADIUS_CAP;
    return matchChunkOnce(
      points,
      FALLBACK_RADIUS_CAP,
      budget,
      `${label} capped`
    );
  }

  if (
    body?.code === 'TooBig' &&
    /coordinates/i.test(body.message || '') &&
    points.length > 3
  ) {
    // Server has a lower --max-matching-size:
    // split the chunk (sharing one point) and retry.
    console.warn(
      `[trip-match] OSRM rejected ${points.length} coordinates; splitting. Set OSRM_MAX_MATCH_COORDS to match the server.`
    );
    const mid = Math.floor(points.length / 2);
    const a = await matchChunkOnce(points.slice(0, mid + 1), radius, budget, `${label} a`);
    const b = await matchChunkOnce(points.slice(mid), radius, budget, `${label} b`);
    return {
      lines: [...a.lines, ...b.lines],
      transient: a.transient || b.transient
    };
  }

  if (body?.code !== 'Ok') {
    return { lines: [], transient: false };
  }

  // Draw matchings[].geometry, never tracepoints.
  const lines = matchings
    .filter(m => m.geometry?.type === 'LineString')
    .map(m => cleanCoords(m.geometry?.coordinates))
    .filter(line => line.length >= 2);

  return { lines, transient: false };
}

async function matchChunk(
  points: GpsSample[],
  budget: Budget,
  label: string
): Promise<ChunkMatch> {
  if (points.length < 2 || !canRequest(budget)) {
    return { lines: [], transient: true };
  }

  const radius = Math.min(RADIUS_DEFAULT_M, radiusCap);

  const first = await matchChunkOnce(
    points,
    radius,
    budget,
    label
  );

  if (first.lines.length || first.transient) return first;

  const wider = Math.min(RADIUS_RETRY_M, radiusCap);
  if (wider <= radius) return first;
  if (!canRequest(budget)) return { lines: [], transient: true };

  // NoMatch etc.: retry once with a wider radius.
  return matchChunkOnce(
    points,
    wider,
    budget,
    `${label} retry`
  );
}

async function routeBetween(
  a: Coordinate,
  b: Coordinate,
  budget: Budget,
  label: string
): Promise<Coordinate[] | null> {
  if (!canRequest(budget)) return null;

  const { body } = await osrmFetch<OsrmRouteResponse>(
    'route',
    [a, b],
    new URLSearchParams({
      overview: 'full',
      geometries: 'geojson',
      steps: 'false'
    }),
    budget,
    label
  );

  debug(label, 'route code', body?.code ?? '(none)');

  if (body?.code !== 'Ok') return null;

  const line = cleanCoords(
    body.routes?.[0]?.geometry?.coordinates
  );

  return line.length >= 2 ? line : null;
}

// ---------------------------------------------------------------------------
// Step 4: bridge pieces into one continuous line
// ---------------------------------------------------------------------------

interface Piece {
  kind: 'matched' | 'raw';
  coords: Coordinate[];
  // True when this piece continues the previous one
  // inside the same GPS segment (chunk overlap).
  continues: boolean;
}

async function bridge(
  a: Coordinate,
  b: Coordinate,
  raw: Coordinate[] | null,
  budget: Budget,
  label: string
): Promise<Coordinate[]> {
  const straight = distance(a, b);

  if (straight < 15) return [a, b];

  const rawLength = raw && raw.length >= 2
    ? lineLength([a, ...raw, b])
    : null;

  if (straight <= BRIDGE_MAX_STRAIGHT_M) {
    const route = await routeBetween(a, b, budget, label);

    if (route) {
      const length = lineLength(route);
      const sane =
        length <= BRIDGE_MAX_DETOUR * straight &&
        // Across an unmatched GPS chunk the route must
        // roughly agree with what was actually driven.
        (rawLength == null ||
          (length >= 0.6 * rawLength &&
            length <= 1.6 * rawLength));

      debug(
        label,
        `straight=${Math.round(straight)}m route=${Math.round(length)}m`,
        rawLength != null ? `raw=${Math.round(rawLength)}m` : '',
        sane ? 'used' : 'rejected'
      );

      if (sane) return [a, ...route, b];
    }
  }

  if (raw && raw.length) return [a, ...raw, b];

  return [a, b];
}

// Find the closest point on line[from..] to p.
function nearestOnTail(
  line: Coordinate[],
  from: number,
  p: Coordinate
): { index: number; point: Coordinate; metres: number } | null {
  let best: { index: number; point: Coordinate; metres: number } | null = null;

  for (let i = Math.max(from, 0); i < line.length - 1; i++) {
    const { point } = projectOnSegment(p, line[i], line[i + 1]);
    const metres = distance(point, p);

    if (!best || metres < best.metres) {
      best = { index: i, point, metres };
    }
  }

  return best;
}

async function assemble(
  pieces: Piece[],
  budget: Budget
): Promise<{
  line: Coordinate[];
  inferred: IndexRange[];
}> {
  const line: Coordinate[] = [];
  const inferred: IndexRange[] = [];

  let pieceStart = 0;
  let pendingRaw: Coordinate[] = [];
  let bridgeNo = 0;

  const appendFrom = (coords: Coordinate[]) => {
    for (const c of coords) {
      const last = line[line.length - 1];
      if (!last || distance(last, c) > 0.5) line.push(c);
    }
  };

  const appendInferred = (connector: Coordinate[]) => {
    const start = Math.max(line.length - 1, 0);
    appendFrom(connector);
    const end = line.length - 1;
    if (end > start) inferred.push([start, end]);
  };

  for (const piece of pieces) {
    if (piece.kind === 'raw') {
      pendingRaw.push(...piece.coords);
      continue;
    }

    const coords = piece.coords;

    if (!line.length && pendingRaw.length) {
      // Trip starts with unmatched GPS: draw it as
      // inferred, then bridge to the first match below.
      appendFrom(pendingRaw);
      if (line.length > 1) inferred.push([0, line.length - 1]);
      pendingRaw = [];
    }

    if (!line.length) {
      pieceStart = 0;
      appendFrom(coords);
      continue;
    }

    const start = coords[0];

    // Consecutive chunks of the same segment overlap by a
    // few points: the next chunk starts on top of the
    // previous geometry. Cut the previous line there so
    // the overlap is not drawn twice.
    if (piece.continues && !pendingRaw.length) {
      const near = nearestOnTail(line, pieceStart, start);

      if (near && near.metres < 30) {
        line.length = near.index + 1;
        appendFrom([near.point]);
        pieceStart = line.length - 1;
        appendFrom(coords);
        continue;
      }
    }

    const end = line[line.length - 1];

    if (distance(end, start) < 10 && !pendingRaw.length) {
      pieceStart = line.length - 1;
      appendFrom(coords);
      continue;
    }

    const connector = await bridge(
      end,
      start,
      pendingRaw.length ? pendingRaw : null,
      budget,
      `bridge ${++bridgeNo}`
    );

    pendingRaw = [];
    appendInferred(connector);
    pieceStart = line.length - 1;
    appendFrom(coords);
  }

  if (pendingRaw.length) {
    // Trip ends with unmatched GPS.
    if (line.length) {
      appendInferred([line[line.length - 1], ...pendingRaw]);
    } else {
      appendFrom(pendingRaw);
      if (line.length > 1) inferred.push([0, line.length - 1]);
    }
  }

  return { line, inferred };
}

function sliceRanges(
  line: Coordinate[],
  inferred: IndexRange[]
): Coordinate[][] {
  const matched: Coordinate[][] = [];
  let cursor = 0;

  for (const [start, end] of inferred) {
    if (start > cursor) matched.push(line.slice(cursor, start + 1));
    cursor = end;
  }

  if (cursor < line.length - 1) {
    matched.push(line.slice(cursor));
  }

  return matched.filter(part => part.length >= 2);
}

// Rebuild the compatibility fields from a persisted line.
export function deriveRoadSegments(
  line: Coordinate[],
  inferred: IndexRange[],
  status: RoadMatchStatus
): Coordinate[][] {
  return status === 'gps-only'
    ? []
    : sliceRanges(line, inferred);
}

// GPS-only: the cleaned trace as one line; jumps across
// missing data are marked as inferred.
function gpsOnly(
  segments: GpsSample[][],
  count: number
): RoadMatchResult {
  const line: Coordinate[] = [];
  const inferred: IndexRange[] = [];

  for (const segment of segments) {
    if (line.length) inferred.push([line.length - 1, line.length]);
    line.push(...segment.map(toCoord));
  }

  return {
    route_line: line,
    inferred_ranges: inferred,
    road_segments: [],
    gps_segments: segments
      .filter(s => s.length >= 2)
      .map(s => s.map(toCoord)),
    road_match_status: 'gps-only',
    road_match_configured: roadMatchingConfigured(),
    gps_points_count: count
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function tripPointsHash(samples: GpsSample[]): string {
  const hash = createHash('sha1');
  for (const p of samples) {
    hash.update(
      `${p.lng.toFixed(6)},${p.lat.toFixed(6)},${p.time ?? ''};`
    );
  }
  return hash.digest('hex').slice(0, 20);
}

export interface MatchOutcome {
  result: RoadMatchResult;
  // False when a timeout / rate limit / request budget
  // cut matching short. Such results must not be
  // persisted permanently.
  complete: boolean;
}

const cache = new Map<string, {
  expires: number;
  data: MatchOutcome;
}>();

const inFlight = new Map<string, Promise<MatchOutcome>>();

/**
 * Road-match a trip. Completed trips: cached in memory
 * (and persisted by the caller) only when complete;
 * incomplete results are not cached, so the next view
 * resumes using the per-call cache. Today's active trip:
 * cached for 5 minutes regardless of new points, to keep
 * the request rate to the OSRM server low.
 */
function matchKey(
  samples: GpsSample[],
  cacheKey: string,
  isLive: boolean
): string {
  return isLive
    ? `${cacheKey}:live`
    : `${cacheKey}:${tripPointsHash(samples)}`;
}

/**
 * A finished match already in memory, or null. Never
 * calls OSRM, so the first trip response stays fast.
 */
export function peekRecordedMatch(
  samples: GpsSample[],
  cacheKey: string,
  isLive = false
): MatchOutcome | null {
  if (!BASE_URL) return null;

  const cached = cache.get(matchKey(samples, cacheKey, isLive));
  return cached && cached.expires > Date.now()
    ? cached.data
    : null;
}

export async function matchRecordedRoute(
  samples: GpsSample[],
  cacheKey: string,
  isLive = false
): Promise<MatchOutcome> {
  if (!BASE_URL) {
    return {
      result: gpsOnly(splitAtGaps(cleanTrace(samples)), samples.length),
      complete: true
    };
  }

  const key = matchKey(samples, cacheKey, isLive);

  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const running = inFlight.get(key);
  if (running) return running;

  const job = computeMatch(samples)
    .then(outcome => {
      const ttl = isLive
        ? LIVE_CACHE_MS
        : outcome.complete
          ? 6 * 3600_000
          : 0;

      if (ttl > 0) {
        cache.set(key, { expires: Date.now() + ttl, data: outcome });
        if (cache.size > CACHE_MAX) {
          const firstKey = cache.keys().next().value;
          if (firstKey !== undefined) cache.delete(firstKey);
        }
      }

      return outcome;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, job);
  return job;
}

async function computeMatch(
  samples: GpsSample[]
): Promise<MatchOutcome> {
  const cleaned = cleanTrace(samples);
  const segments = splitAtGaps(cleaned);

  if (!cleaned.length) {
    return {
      result: gpsOnly(segments, samples.length),
      complete: true
    };
  }

  const thinned = segments.map(thin);

  const chunks: Array<{
    points: GpsSample[];
    continues: boolean;
  }> = [];

  for (const segment of thinned) {
    if (segment.length < 2) {
      // Single fix between gaps: keep as raw so it can
      // still be bridged through.
      chunks.push({ points: segment, continues: false });
      continue;
    }

    chunk(segment).forEach((points, index) => {
      chunks.push({ points, continues: index > 0 });
    });
  }

  debug(
    `samples=${samples.length} cleaned=${cleaned.length}`,
    `segments=${segments.length}`,
    `thinned=${thinned.reduce((n, s) => n + s.length, 0)}`,
    `chunks=${chunks.length}`,
    `base=${BASE_URL}`
  );

  const budget: Budget = {
    requests: 0,
    deadline: Date.now() + TOTAL_BUDGET_MS,
    transientFailures: 0,
    exhausted: false
  };

  const results: ChunkMatch[] = Array(chunks.length);
  let next = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, chunks.length) },
      async () => {
        while (next < chunks.length) {
          const index = next++;
          const { points } = chunks[index];

          results[index] = points.length >= 2
            ? await matchChunk(
                points,
                budget,
                `chunk ${index + 1}/${chunks.length} (${points.length} pts)`
              )
            : { lines: [], transient: false };
        }
      }
    )
  );

  let matchedChunks = 0;
  let transient = false;

  const pieces: Piece[] = [];
  const gpsSegments: Coordinate[][] = [];

  chunks.forEach(({ points, continues }, index) => {
    const { lines, transient: t } = results[index];
    transient ||= t;

    if (lines.length) {
      matchedChunks++;
      lines.forEach((coords, i) => {
        pieces.push({
          kind: 'matched',
          coords,
          continues: continues || i > 0
        });
      });
    } else {
      // Skip the overlap points already covered by the
      // previous chunk.
      const raw = (continues
        ? points.slice(CHUNK_OVERLAP)
        : points
      ).map(toCoord);

      if (points.length >= 2) gpsSegments.push(points.map(toCoord));
      if (raw.length) {
        pieces.push({ kind: 'raw', coords: raw, continues });
      }
    }
  });

  if (!matchedChunks) {
    return {
      result: gpsOnly(segments, samples.length),
      complete: !transient && !budget.exhausted
    };
  }

  const { line, inferred } = await assemble(pieces, budget);

  const matchableChunks = chunks.filter(c => c.points.length >= 2).length;

  const result: RoadMatchResult = {
    route_line: line,
    inferred_ranges: inferred,
    road_segments: sliceRanges(line, inferred),
    gps_segments: gpsSegments,
    road_match_status:
      matchedChunks === matchableChunks ? 'matched' : 'partial',
    road_match_configured: true,
    gps_points_count: samples.length
  };

  // Out of time, out of requests, or the server was
  // failing: return what we have, but it is not final.
  const complete = !transient && !budget.exhausted;

  if (!complete) result.road_match_status = 'partial';

  debug(
    `status=${result.road_match_status}`,
    `matchedChunks=${matchedChunks}/${matchableChunks}`,
    `line=${line.length} pts`,
    `inferred=${JSON.stringify(inferred)}`,
    `requests=${budget.requests}`,
    `complete=${complete}`
  );

  return { result, complete };
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
