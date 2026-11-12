import 'server-only';

// Shared OSRM access for trip road matching and
// /api/road-route: which server to use, and how to
// behave politely towards the public demo server.

export const PUBLIC_OSRM_URL = 'https://router.project-osrm.org';

// Identifies this app to the OSRM operators, as their
// usage policy asks. No personal data.
const USER_AGENT =
  'K-Track-Vehicle-Tracker/1.0 (trip road matching; +https://github.com/rjumair711/Vehicle-Tacking-System)';

// The public demo allows at most 1 request per second.
const PUBLIC_MIN_INTERVAL_MS = 1000;
const RETRY_DELAY_MS = 2000;

function isPublic(url: string): boolean {
  return url.includes('router.project-osrm.org');
}

/**
 * OSRM base URL, or '' when road matching is disabled.
 *
 * - OSRM_MATCH_BASE_URL: your own server (always allowed).
 * - ALLOW_PUBLIC_OSRM=true: use the public demo server,
 *   also in production. It is free but rate-limited, has
 *   no uptime guarantee, and receives the coordinates.
 * - Development without either falls back to the demo.
 */
export function resolveOsrmBaseUrl(): string {
  const base = (process.env.OSRM_MATCH_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(match|route)\/v1\/[^/]+$/, '');

  const allowPublic = process.env.ALLOW_PUBLIC_OSRM === 'true';
  const isProduction = process.env.NODE_ENV === 'production';

  if (base && !isPublic(base)) return base;

  if (allowPublic || !isProduction) {
    return PUBLIC_OSRM_URL;
  }

  if (base) {
    console.warn(
      '[osrm] OSRM_MATCH_BASE_URL points at the public demo server; set ALLOW_PUBLIC_OSRM=true to allow it in production.'
    );
  }

  return '';
}

export const OSRM_BASE_URL = resolveOsrmBaseUrl();
export const OSRM_IS_PUBLIC = isPublic(OSRM_BASE_URL);

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

// Serialises request starts to the public server, at
// least 1 s apart. Applies per server instance.
let nextSlot = 0;
let queue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  if (!OSRM_IS_PUBLIC) return Promise.resolve();

  const turn = queue.then(async () => {
    const wait = nextSlot - Date.now();
    if (wait > 0) await sleep(wait);
    nextSlot = Date.now() + PUBLIC_MIN_INTERVAL_MS;
  });

  queue = turn.catch(() => undefined);
  return turn;
}

export interface OsrmFetchResult<T> {
  // 0 = network error / timeout / out of time
  status: number;
  body: T | null;
  // True when the server is rate-limiting or failing.
  transient: boolean;
}

/**
 * GET {base}/{path}. Throttled for the public server,
 * sends a User-Agent, retries once after 2 s on 429 or
 * 5xx, and never throws. Gives up when `deadline`
 * (epoch ms) would be passed.
 */
export async function osrmGet<T>(
  path: string,
  options: {
    deadline?: number;
    timeoutMs?: number;
  } = {}
): Promise<OsrmFetchResult<T>> {
  if (!OSRM_BASE_URL) {
    return { status: 0, body: null, transient: false };
  }

  const deadline = options.deadline ?? Infinity;
  const timeoutMs = options.timeoutMs ?? 8000;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      if (Date.now() + RETRY_DELAY_MS >= deadline) break;
      await sleep(RETRY_DELAY_MS);
    }

    await throttle();

    const remaining = deadline - Date.now();
    if (remaining <= 250) break;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(timeoutMs, remaining)
    );

    try {
      const response = await fetch(`${OSRM_BASE_URL}/${path}`, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT
        }
      });

      let body: T | null = null;
      try {
        body = (await response.json()) as T;
      } catch {
        body = null;
      }

      const retryable =
        response.status === 429 || response.status >= 500;

      if (retryable && attempt === 0) continue;

      return {
        status: response.status,
        body,
        transient: retryable
      };
    } catch {
      // Network error or timeout: no retry.
      return { status: 0, body: null, transient: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return { status: 0, body: null, transient: true };
}
