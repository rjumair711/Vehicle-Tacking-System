"use client";

import React, { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet"
import { Vehicle } from "@/types";

// Fix default marker icons in Next.js
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";


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
  vehicles: Vehicle[];
  selectedVehicleId?: string;
  onVehicleSelect?: (vehicleId: string) => void;
}

function Recenter({ vehicles, selectedVehicleId }: { vehicles: Vehicle[]; selectedVehicleId?: string }) {
  const map = useMap();

  useEffect(() => {
    const v = vehicles.find((x) => x.id === selectedVehicleId);
    if (v) {
      map.setView([v.location.lat, v.location.lng], Math.max(map.getZoom(), 14), { animate: true });
    }
  }, [vehicles, selectedVehicleId, map]);

  return null;
}

export function VehicleMap({ vehicles, selectedVehicleId, onVehicleSelect }: VehicleMapProps) {
  const center: [number, number] = [33.6844, 73.0479]; // Islamabad default

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
        {/* OpenStreetMap tiles */}
        <TileLayer
          attribution=''
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Recenter vehicles={vehicles} selectedVehicleId={selectedVehicleId} />

        {vehicles.map((v) => (
          <Marker
            key={v.id}
            position={[v.location.lat, v.location.lng]}
            eventHandlers={{
              click: () => onVehicleSelect?.(v.id),
            }}
          >
            <Popup>
              <div className="space-y-1">
                <div className="font-semibold">{v.name}</div>
                <div className="text-xs">Plate: {v.licensePlate}</div>
                <div className="text-xs">Status: {v.status}</div>
                <div className="text-xs">Speed: {v.currentSpeed} km/h</div>
                <div className="text-xs">
                  {v.location.lat.toFixed(5)}, {v.location.lng.toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}