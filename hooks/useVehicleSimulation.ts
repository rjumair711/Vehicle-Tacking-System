import { useEffect, useRef, useState } from "react";
import { Vehicle } from "@/types";

export function useVehicleSimulation(initialVehicles: Vehicle[], enabled: boolean = true) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const simulationRef = useRef<NodeJS.Timeout | null>(null);

  // ✅ IMPORTANT: sync when initialVehicles arrives/changes
  useEffect(() => {
    if (initialVehicles?.length) {
      setVehicles(initialVehicles);
    }
  }, [initialVehicles]);

  useEffect(() => {
    // stop if disabled or nothing to simulate
    if (!enabled || vehicles.length === 0) {
      if (simulationRef.current) clearInterval(simulationRef.current);
      simulationRef.current = null;
      return;
    }

    // avoid multiple intervals
    if (simulationRef.current) clearInterval(simulationRef.current);

    simulationRef.current = setInterval(() => {
      setVehicles((prevVehicles) =>
        prevVehicles.map((vehicle) => {
          if (vehicle.status === "offline") return vehicle;

          const moveDistance = Math.random() * 0.002; // ~200m
          const moveAngle = Math.random() * Math.PI * 2;

          const newLat = vehicle.location.lat + Math.cos(moveAngle) * moveDistance;
          const newLng = vehicle.location.lng + Math.sin(moveAngle) * moveDistance;

          const newSpeed = Math.max(0, vehicle.currentSpeed + (Math.random() - 0.5) * 20);
          const newHeading = Math.random() * 360;

          const fuelDecrease = Math.random() * 0.02;
          const newFuelLevel = Math.max(0, vehicle.fuelLevel - fuelDecrease);

          const distanceIncrease = (newSpeed / 3600) * 0.1;

          let status = vehicle.status;
          if (Math.random() < 0.01) {
            const statuses: Array<"online" | "idle" | "moving" | "parked"> = [
              "online",
              "moving",
              "idle",
              "parked",
            ];
            status = statuses[Math.floor(Math.random() * statuses.length)];
          }

          return {
            ...vehicle,
            location: {
              ...vehicle.location,
              lat: newLat,
              lng: newLng,
              timestamp: new Date(),
              heading: newHeading,
              speed: newSpeed,
            },
            currentSpeed: Math.round(newSpeed),
            fuelLevel: newFuelLevel,
            totalDistance: vehicle.totalDistance + distanceIncrease,
            status,
            lastUpdate: new Date(),
          };
        })
      );
    }, 2000);

    return () => {
      if (simulationRef.current) clearInterval(simulationRef.current);
      simulationRef.current = null;
    };
  }, [enabled, vehicles.length]);

  return vehicles;
}