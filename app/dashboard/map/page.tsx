"use client";

import { useEffect, useState } from "react";
import { generateMockTrackers } from "@/lib/mockData";
import { TrackingDevice } from "@/types";

export default function MapPage() {
  const [trackers, setTrackers] = useState<TrackingDevice[]>([]);

  useEffect(() => {
    setTrackers(generateMockTrackers());

    const interval = setInterval(() => {
      setTrackers(generateMockTrackers());
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Live Tracker Map</h1>
        <p className="text-sm text-gray-500">
          Real-time tracker simulation updated every 5 seconds.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map Placeholder */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">Map View</h2>

          <div className="h-[500px] rounded-lg bg-gray-100 flex items-center justify-center relative overflow-hidden">
            <div className="text-center text-gray-500">
              <p className="text-lg font-semibold">Map Placeholder</p>
              <p className="text-sm">
                Later this will be replaced with Leaflet / Mapbox live map.
              </p>
            </div>

            {trackers.map((tracker, index) => (
              <div
                key={tracker.trackerId}
                className="absolute w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow"
                style={{
                  left: `${25 + index * 20}%`,
                  top: `${35 + index * 12}%`,
                }}
                title={`${tracker.name} - ${tracker.location?.speed ?? 0} km/h`}
              />
            ))}
          </div>
        </div>

        {/* Tracker List */}
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">Trackers</h2>

          <div className="space-y-4">
            {trackers.map((tracker) => (
              <div
                key={tracker.trackerId}
                className="border rounded-lg p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">
                    {tracker.name ?? tracker.trackerId}
                  </h3>

                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      tracker.status === "active"
                        ? "bg-green-100 text-green-700"
                        : tracker.status === "error"
                        ? "bg-red-100 text-red-700"
                        : tracker.status === "suspended"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {tracker.status}
                  </span>
                </div>

                <p className="text-sm text-gray-600">
                  Tracker ID: {tracker.trackerId}
                </p>

                <p className="text-sm text-gray-600">
                  Plate: {tracker.licensePlate ?? "N/A"}
                </p>

                <p className="text-sm text-gray-600">
                  Speed: {tracker.location?.speed ?? 0} km/h
                </p>

                <p className="text-sm text-gray-600">
                  Latitude: {tracker.location?.lat.toFixed(5) ?? "N/A"}
                </p>

                <p className="text-sm text-gray-600">
                  Longitude: {tracker.location?.lng.toFixed(5) ?? "N/A"}
                </p>

                <p className="text-sm text-gray-600">
                  Last Ping:{" "}
                  {tracker.lastPing
                    ? tracker.lastPing.toLocaleTimeString()
                    : "N/A"}
                </p>

                <p className="text-sm text-gray-600">
                  Battery: {tracker.battery ?? "N/A"}%
                </p>

                <p className="text-sm text-gray-600">
                  Signal: {tracker.signalStrength ?? "N/A"} dBm
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}