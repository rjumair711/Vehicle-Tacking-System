"use client";

import React, { useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  CircleMarker,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { Geofence } from "@/types";

type Point = { lat: number; lng: number };

interface GeofenceMapProps {
  /** Saved zones, drawn for reference. */
  geofences: Geofence[];
  /** Corners of the zone being drawn. Leave undefined for a view-only map. */
  drawing?: Point[];
  drawingColor?: string;
  /** Called with the new corner list when the user clicks the map. */
  onDrawingChange?: (points: Point[]) => void;
  /** Where to centre when there is nothing to show yet (e.g. the tracker's position). */
  fallbackCenter?: Point;
}

function FixMapSize() {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(timer);
  }, [map]);

  return null;
}

// Fits the map once to what is already there: the zone being edited, else
// the saved zones, else the fallback position.
function InitialView({
  geofences,
  drawing,
  fallbackCenter,
}: Pick<GeofenceMapProps, "geofences" | "drawing" | "fallbackCenter">) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;

    const points =
      drawing && drawing.length > 0 ? drawing : geofences.flatMap((g) => g.points);

    if (points.length > 0) {
      done.current = true;
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
        padding: [40, 40],
        maxZoom: 16,
      });
    } else if (fallbackCenter) {
      done.current = true;
      map.setView([fallbackCenter.lat, fallbackCenter.lng], 14);
    }
  }, [map, geofences, drawing, fallbackCenter]);

  return null;
}

function ClickToAddCorner({ onAdd }: { onAdd: (point: Point) => void }) {
  useMapEvents({
    click: (event) => onAdd({ lat: event.latlng.lat, lng: event.latlng.lng }),
  });
  return null;
}

export function GeofenceMap({
  geofences,
  drawing,
  drawingColor = "#3b82f6",
  onDrawingChange,
  fallbackCenter,
}: GeofenceMapProps) {
  const center: [number, number] = [33.6844, 73.0479]; // Islamabad default
  const isDrawing = drawing !== undefined && onDrawingChange !== undefined;

  return (
    <div className="h-full w-full">
      <MapContainer center={center} zoom={12} scrollWheelZoom className="h-full w-full">
        <FixMapSize />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <InitialView geofences={geofences} drawing={drawing} fallbackCenter={fallbackCenter} />

        {geofences.map((geofence) => (
          <Polygon
            key={geofence.id}
            positions={geofence.points.map((p) => [p.lat, p.lng])}
            pathOptions={{
              color: geofence.color,
              weight: 2,
              fillOpacity: isDrawing ? 0.08 : 0.2,
              // let clicks through to the map while a new zone is drawn
              interactive: !isDrawing,
            }}
          >
            {!isDrawing && <Tooltip sticky>{geofence.name}</Tooltip>}
          </Polygon>
        ))}

        {isDrawing && (
          <>
            <ClickToAddCorner onAdd={(point) => onDrawingChange([...drawing, point])} />

            {drawing.length >= 3 && (
              <Polygon
                positions={drawing.map((p) => [p.lat, p.lng])}
                pathOptions={{ color: drawingColor, weight: 3, fillOpacity: 0.25, interactive: false }}
              />
            )}
            {drawing.length === 2 && (
              <Polyline
                positions={drawing.map((p) => [p.lat, p.lng])}
                pathOptions={{ color: drawingColor, weight: 3, interactive: false }}
              />
            )}
            {drawing.map((point, index) => (
              <CircleMarker
                key={`${index}-${point.lat}-${point.lng}`}
                center={[point.lat, point.lng]}
                radius={6}
                pathOptions={{
                  color: "#ffffff",
                  weight: 2,
                  fillColor: drawingColor,
                  fillOpacity: 1,
                  interactive: false,
                }}
              />
            ))}
          </>
        )}
      </MapContainer>
    </div>
  );
}
