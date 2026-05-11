"use client";

import React, { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { TrackingDevice } from "@/types";

// Fix default marker icons in Next.js
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const startIcon = L.divIcon({
  html: `
    <div style="
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      background: #16a34a;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      border: 3px solid white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.35);
    ">
      S
    </div>
  `,
  className: "",
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const endIcon = L.divIcon({
  html: `
    <div style="
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      background: #dc2626;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      border: 3px solid white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.35);
    ">
      E
    </div>
  `,
  className: "",
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

type RoutePoint = {
  lat: number;
  lng: number;
};

function FixMapSize() {
  const map = useMap();

  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize();
    }, 200);
  }, [map]);

  return null;
}

delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: (markerIcon2x as any).src ?? markerIcon2x,
  iconUrl: (markerIcon as any).src ?? markerIcon,
  shadowUrl: (markerShadow as any).src ?? markerShadow,
});

interface VehicleMapProps {
  vehicles: TrackingDevice[];
  selectedVehicleId?: string;
  onVehicleSelect?: (vehicleId: string) => void;

  /**
   * Used when opening a trip from Trips page.
   * Example:
   * [
   *   { lat: 33.6844, lng: 73.0479 },
   *   { lat: 33.6900, lng: 73.0550 }
   * ]
   */
  routePoints?: RoutePoint[];
}

function Recenter({
  vehicles,
  selectedVehicleId,
  routePoints,
}: {
  vehicles: TrackingDevice[];
  selectedVehicleId?: string;
  routePoints?: RoutePoint[];
}) {
  const map = useMap();

  useEffect(() => {
    if (routePoints && routePoints.length > 0) {
      const bounds = L.latLngBounds(
        routePoints.map((point) => [point.lat, point.lng])
      );

      map.fitBounds(bounds, {
        padding: [40, 40],
      });

      return;
    }

    const selectedVehicle = vehicles.find(
      (vehicle) => vehicle.trackerId === selectedVehicleId
    );

    if (selectedVehicle?.location) {
      map.setView(
        [selectedVehicle.location.lat, selectedVehicle.location.lng],
        Math.max(map.getZoom(), 14),
        { animate: true }
      );
    }
  }, [vehicles, selectedVehicleId, routePoints, map]);

  return null;
}

export function VehicleMap({
  vehicles,
  selectedVehicleId,
  onVehicleSelect,
  routePoints,
}: VehicleMapProps) {
  const center: [number, number] = [33.6844, 73.0479]; // Islamabad default

  const validVehicles = vehicles.filter((vehicle) => vehicle.location);

  const polylinePositions: [number, number][] =
    routePoints?.map((point) => [point.lat, point.lng]) ?? [];

  const hasRoute = routePoints && routePoints.length > 1;
  const startPoint = hasRoute ? routePoints[0] : undefined;
  const endPoint = hasRoute ? routePoints[routePoints.length - 1] : undefined;

  return (
    <div className="h-full w-full">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom
        className="h-full w-full"
        attributionControl={false}
      >
        <FixMapSize />

        <TileLayer
          attribution=""
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Recenter
          vehicles={validVehicles}
          selectedVehicleId={selectedVehicleId}
          routePoints={routePoints}
        />

        {polylinePositions.length > 1 && (
          <Polyline positions={polylinePositions} weight={5} />
        )}
        {startPoint && (
          <Marker position={[startPoint.lat, startPoint.lng]} icon={startIcon}>
            <Popup>
              <div className="space-y-1">
                <div className="font-semibold">Start Point</div>
                <div className="text-xs">
                  {startPoint.lat.toFixed(5)}, {startPoint.lng.toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        {endPoint && (
          <Marker position={[endPoint.lat, endPoint.lng]} icon={endIcon}>
            <Popup>
              <div className="space-y-1">
                <div className="font-semibold">End Point</div>
                <div className="text-xs">
                  {endPoint.lat.toFixed(5)}, {endPoint.lng.toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        {validVehicles.map((vehicle) => (
          <Marker
            key={vehicle.trackerId}
            position={[vehicle.location!.lat, vehicle.location!.lng]}
            eventHandlers={{
              click: () => onVehicleSelect?.(vehicle.trackerId),
            }}
          >
            <Popup>
              <div className="space-y-1">
                <div className="font-semibold">
                  {vehicle.name ?? "Unnamed Tracker"}
                </div>

                <div className="text-xs">
                  Plate: {vehicle.licensePlate ?? "N/A"}
                </div>

                <div className="text-xs">Status: {vehicle.status}</div>

                <div className="text-xs">
                  Speed: {vehicle.location?.speed ?? 0} km/h
                </div>

                <div className="text-xs">
                  {vehicle.location!.lat.toFixed(5)},{" "}
                  {vehicle.location!.lng.toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}