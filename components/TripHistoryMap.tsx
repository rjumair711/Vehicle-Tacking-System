
'use client';

import { useMemo } from 'react';
import {
  MapContainer,
  TileLayer
} from 'react-leaflet';

import 'leaflet/dist/leaflet.css';

import TripRouteLayer, {
  type TripRouteDetail
} from '@/components/TripRouteLayer';

import TripRouteLegend from '@/components/TripRouteLegend';

type Coordinate = [number, number];

function isCoordinate(
  value: unknown
): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

function getInitialCenter(
  trip: TripRouteDetail
): [number, number] {
  const roadPoint =
    trip.road_segments?.[0]?.[0];

  const gpsPoint =
    trip.gps_segments?.[0]?.[0];

  let coordinate = roadPoint || gpsPoint;

  if (!isCoordinate(coordinate)) {
    try {
      const raw =
        trip.route_geojson ||
        trip.routeGeojson;

      const parsed =
        typeof raw === 'string'
          ? JSON.parse(raw)
          : raw;

      if (parsed?.type === 'LineString') {
        coordinate = parsed.coordinates?.[0];
      }
    } catch {
      // Invalid legacy geometry.
    }
  }

  if (isCoordinate(coordinate)) {
    return [
      coordinate[1],
      coordinate[0]
    ];
  }

  // Used only until a valid route can be located.
  return [33.6, 73.1];
}

export default function TripHistoryMap({
  trip
}: {
  trip: TripRouteDetail;
}) {
  const center = useMemo(
    () => getInitialCenter(trip),
    [trip]
  );

  return (
    <div className="relative h-full min-h-[350px] w-full overflow-hidden bg-muted">
      <MapContainer
        center={center}
        zoom={14}
        scrollWheelZoom
        zoomControl
        className="h-full w-full"
        style={{
          height: '100%',
          width: '100%'
        }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        <TripRouteLayer trip={trip} />
      </MapContainer>

      <div className="pointer-events-none absolute bottom-4 left-3 right-3 z-[1000] sm:left-4">
        <div className="pointer-events-auto max-w-lg">
          <TripRouteLegend trip={trip} />
        </div>
      </div>
    </div>
  );
}
