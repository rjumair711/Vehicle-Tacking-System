// Shape helpers for the geofence editor (no server imports, safe in the browser).

export type LatLng = { lat: number; lng: number };

function same(a: LatLng, b: LatLng) {
  return a.lat === b.lat && a.lng === b.lng;
}

// Drops a corner that repeats the one before it, and a last corner that
// repeats the first (zones saved before the double-click fix have these).
export function withoutRepeats(points: LatLng[]): LatLng[] {
  const result = points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
  while (result.length > 1 && same(result[0], result[result.length - 1])) result.pop();
  return result;
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

// > 0 when r is left of p→q, < 0 when right, 0 when on the line.
function orient(p: LatLng, q: LatLng, r: LatLng) {
  return Math.sign((q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng));
}

// r is on the line p→q; is it between them?
function within(p: LatLng, q: LatLng, r: LatLng) {
  return (
    Math.min(p.lng, q.lng) <= r.lng && r.lng <= Math.max(p.lng, q.lng) &&
    Math.min(p.lat, q.lat) <= r.lat && r.lat <= Math.max(p.lat, q.lat)
  );
}

function segmentsTouch(a: LatLng, b: LatLng, c: LatLng, d: LatLng) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (
    (o1 === 0 && within(a, b, c)) || (o2 === 0 && within(a, b, d)) ||
    (o3 === 0 && within(c, d, a)) || (o4 === 0 && within(c, d, b))
  );
}

// True when two edges of the closed outline cross or touch (edges that share
// a corner are not compared). Lat/lng are treated as flat, fine at zone size.
export function selfIntersects(points: LatLng[]): boolean {
  const n = points.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // first and last edge share corner 0
      if (segmentsTouch(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}
