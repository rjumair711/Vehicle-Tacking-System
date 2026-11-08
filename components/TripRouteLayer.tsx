
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
  LatLngExpression
} from 'leaflet';

type LonLat = [number, number];

export interface TripRouteDetail {
  road_segments?: LonLat[][] | null;
  gps_segments?: LonLat[][] | null;

  road_match_status?:
    | 'matched'
    | 'partial'
    | 'gps-only'
    | null;

  route_geojson?: string | null;
  routeGeojson?: string | null;

  gps_points_count?: number;
}

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

const toLeaflet = (
  point: LonLat
): [number, number] => [
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

function ZoomToTrip({
  points
}: {
  points: [number, number][];
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
        padding: [36, 36],
        maxZoom: 16,
        animate: false
      });
    }
  }, [map, signature]);

  return null;
}

export default function TripRouteLayer({
  trip
}: {
  trip: TripRouteDetail;
}) {
  const route = useMemo(() => {
    const hasProcessed =
      (trip.road_segments?.length || 0) > 0 ||
      (trip.gps_segments?.length || 0) > 0;

    const matched = (
      trip.road_segments || []
    )
      .filter(line =>
        Array.isArray(line) &&
        line.length >= 2
      )
      .map(line =>
        line.filter(valid).map(toLeaflet)
      )
      .filter(line => line.length >= 2);

    const rawSource = hasProcessed
      ? trip.gps_segments || []
      : geojsonRawLines(
          trip.route_geojson ||
          trip.routeGeojson
        );

    const raw = rawSource
      .filter(line =>
        Array.isArray(line) &&
        line.length >= 2
      )
      .map(line =>
        line.filter(valid).map(toLeaflet)
      )
      .filter(line => line.length >= 2);

    const all = [
      ...matched,
      ...raw
    ].flat();

    const original = geojsonRawLines(
      trip.route_geojson ||
      trip.routeGeojson
    )
      .flat()
      .filter(valid);

    const start = original.length
      ? toLeaflet(original[0])
      : all[0];

    const finish = original.length
      ? toLeaflet(
          original[original.length - 1]
        )
      : all[all.length - 1];

    return {
      matched,
      raw,
      all,
      start,
      finish
    };
  }, [
    trip.road_segments,
    trip.gps_segments,
    trip.route_geojson,
    trip.routeGeojson
  ]);

  if (!route.all.length) {
    return null;
  }

  return (
    <>
      <ZoomToTrip points={route.all} />

      {route.raw.map((line, index) => (
        <Polyline
          key={`gps-${index}`}
          positions={
            line as LatLngExpression[]
          }
          pathOptions={{
            color: '#D97706',
            weight: 4,
            opacity: 0.85,
            dashArray: '7 8',
            lineJoin: 'round'
          }}
        />
      ))}

      {route.matched.map(
        (line, index) => (
          <Polyline
            key={`shadow-${index}`}
            positions={
              line as LatLngExpression[]
            }
            pathOptions={{
              color: '#FFFFFF',
              weight: 10,
              opacity: 0.94,
              lineCap: 'round',
              lineJoin: 'round'
            }}
          />
        )
      )}

      {route.matched.map(
        (line, index) => (
          <Polyline
            key={`road-${index}`}
            positions={
              line as LatLngExpression[]
            }
            pathOptions={{
              color: '#059669',
              weight: 6,
              opacity: 1,
              lineCap: 'round',
              lineJoin: 'round'
            }}
          />
        )
      )}

      {route.start && (
        <CircleMarker
          center={route.start}
          radius={9}
          pathOptions={{
            color: 'white',
            weight: 3,
            fillColor: '#059669',
            fillOpacity: 1
          }}
        >
          <Tooltip
            permanent
            direction="top"
            offset={[0, -8]}
          >
            START
          </Tooltip>
        </CircleMarker>
      )}

      {route.finish && (
        <CircleMarker
          center={route.finish}
          radius={9}
          pathOptions={{
            color: 'white',
            weight: 3,
            fillColor: '#DC2626',
            fillOpacity: 1
          }}
        >
          <Tooltip
            permanent
            direction="top"
            offset={[0, -8]}
          >
            END
          </Tooltip>
        </CircleMarker>
      )}
    </>
  );
}
