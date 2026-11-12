
'use client';

import {
  useEffect,
  useMemo
} from 'react';

import {
  CircleMarker,
  Polyline,
  Tooltip,
  useMap
} from 'react-leaflet';

import type {
  LatLngExpression,
  PointExpression,
  Direction
} from 'leaflet';

type LonLat = [number, number];
type LatLng = [number, number];

export interface TripRouteDetail {
  // Single continuous [lng, lat] line from the API.
  route_line?: LonLat[] | null;
  // Inclusive vertex ranges of route_line that are
  // estimated connectors.
  inferred_ranges?: [number, number][] | null;

  road_segments?: LonLat[][] | null;
  gps_segments?: LonLat[][] | null;

  road_match_status?:
    | 'matched'
    | 'partial'
    | 'gps-only'
    | null;

  road_match_configured?: boolean;

  route_geojson?: string | null;
  routeGeojson?: string | null;

  gps_points_count?: number;
}

export const ROUTE_COLOR = '#2563eb';

function valid(
  point: unknown
): point is LonLat {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 180 &&
    Math.abs(point[1]) <= 90
  );
}

// The single [lng, lat] -> [lat, lng] conversion.
const toLeaflet = (
  point: LonLat
): LatLng => [
  point[1],
  point[0]
];

function geojsonRawLines(
  raw?: string | null
): LonLat[][] {
  if (!raw) return [];

  try {
    const obj = JSON.parse(raw) as {
      type: string;
      coordinates: unknown;
    };

    if (
      obj.type === 'LineString' &&
      Array.isArray(obj.coordinates)
    ) {
      return [
        obj.coordinates.filter(valid)
      ];
    }

    if (
      obj.type === 'MultiLineString' &&
      Array.isArray(obj.coordinates)
    ) {
      return obj.coordinates
        .filter(Array.isArray)
        .map(line => line.filter(valid));
    }
  } catch {
    // No valid route geometry.
  }

  return [];
}

function metres(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const x =
    Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
    Math.cos(a[0] * rad) *
      Math.cos(b[0] * rad) *
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(x));
}

// Build the continuous line and split it into
// matched / inferred slices that share endpoints.
function buildRoute(trip: TripRouteDetail) {
  let lonLat: LonLat[] = (trip.route_line || []).filter(valid);
  let ranges = (trip.inferred_ranges || []).filter(
    r =>
      Array.isArray(r) &&
      Number.isInteger(r[0]) &&
      Number.isInteger(r[1]) &&
      r[1] > r[0]
  );

  // Older API responses: join whatever segments exist.
  if (lonLat.length < 2) {
    const parts = [
      ...(trip.road_segments || []),
      ...(trip.gps_segments || [])
    ];
    const lines = parts.length
      ? parts
      : geojsonRawLines(trip.route_geojson || trip.routeGeojson);

    lonLat = lines.flatMap(line => (line || []).filter(valid));
    ranges = [];
  }

  const line = lonLat.map(toLeaflet);

  const matched: LatLng[][] = [];
  const inferred: LatLng[][] = [];
  let cursor = 0;

  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start >= line.length) break;
    if (start > cursor) matched.push(line.slice(cursor, start + 1));
    inferred.push(line.slice(start, Math.min(end, line.length - 1) + 1));
    cursor = Math.max(cursor, end);
  }

  if (cursor < line.length - 1) matched.push(line.slice(cursor));

  return {
    line,
    matched: matched.filter(s => s.length >= 2),
    inferred: inferred.filter(s => s.length >= 2)
  };
}

function ZoomToTrip({
  points
}: {
  points: LatLng[];
}) {
  const map = useMap();

  const signature = points.length
    ? [
        points.length,
        points[0].join(','),
        points[points.length - 1].join(',')
      ].join('-')
    : '';

  useEffect(() => {
    if (!points.length) return;

    if (points.length === 1) {
      map.setView(points[0], 16);
    } else {
      map.fitBounds(points, {
        padding: [40, 40],
        maxZoom: 17,
        animate: false
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);

  return null;
}

function Endpoint({
  center,
  color,
  label,
  direction,
  offset
}: {
  center: LatLng;
  color: string;
  label: string;
  direction: Direction;
  offset: PointExpression;
}) {
  return (
    <CircleMarker
      center={center}
      radius={9}
      pathOptions={{
        color: 'white',
        weight: 3,
        fillColor: color,
        fillOpacity: 1
      }}
    >
      <Tooltip
        permanent
        direction={direction}
        offset={offset}
      >
        {label}
      </Tooltip>
    </CircleMarker>
  );
}

export default function TripRouteLayer({
  trip
}: {
  trip: TripRouteDetail;
}) {
  const route = useMemo(
    () => buildRoute(trip),
    [
      trip.route_line,
      trip.inferred_ranges,
      trip.road_segments,
      trip.gps_segments,
      trip.route_geojson,
      trip.routeGeojson
    ]
  );

  if (!route.line.length) {
    return null;
  }

  const start = route.line[0];
  const finish = route.line[route.line.length - 1];

  // Round trips: put the labels on opposite sides so
  // START and END don't sit on top of each other.
  const overlap =
    route.line.length > 1 && metres(start, finish) < 120;

  const lineStyle = {
    lineCap: 'round' as const,
    lineJoin: 'round' as const
  };

  return (
    <>
      <ZoomToTrip points={route.line} />

      {/* White casing under the whole line. */}
      <Polyline
        positions={route.line as LatLngExpression[]}
        pathOptions={{
          ...lineStyle,
          color: '#FFFFFF',
          weight: 8,
          opacity: 0.8
        }}
      />

      {route.inferred.map((line, index) => (
        <Polyline
          key={`inferred-${index}`}
          positions={line as LatLngExpression[]}
          pathOptions={{
            ...lineStyle,
            color: ROUTE_COLOR,
            weight: 5,
            opacity: 0.6
          }}
        />
      ))}

      {route.matched.map((line, index) => (
        <Polyline
          key={`route-${index}`}
          positions={line as LatLngExpression[]}
          pathOptions={{
            ...lineStyle,
            color: ROUTE_COLOR,
            weight: 5,
            opacity: 0.9
          }}
        />
      ))}

      <Endpoint
        center={start}
        color="#059669"
        label="START"
        direction={overlap ? 'left' : 'top'}
        offset={overlap ? [-10, 0] : [0, -8]}
      />

      {route.line.length > 1 && (
        <Endpoint
          center={finish}
          color="#DC2626"
          label="END"
          direction={overlap ? 'right' : 'top'}
          offset={overlap ? [10, 0] : [0, -8]}
        />
      )}
    </>
  );
}
