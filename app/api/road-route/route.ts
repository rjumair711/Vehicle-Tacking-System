import { NextResponse } from "next/server";

type RoutePoint = {
  lat: number;
  lng: number;
};

function samplePoints(points: RoutePoint[], maxPoints = 25) {
  if (points.length <= maxPoints) return points;

  const sampled: RoutePoint[] = [];
  const step = Math.ceil(points.length / maxPoints);

  for (let i = 0; i < points.length; i += step) {
    sampled.push(points[i]);
  }

  const lastPoint = points[points.length - 1];
  const sampledLastPoint = sampled[sampled.length - 1];

  if (
    sampledLastPoint.lat !== lastPoint.lat ||
    sampledLastPoint.lng !== lastPoint.lng
  ) {
    sampled.push(lastPoint);
  }

  return sampled;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const points: RoutePoint[] = body.points;

    if (!Array.isArray(points) || points.length < 2) {
      return NextResponse.json(
        { success: false, message: "At least two route points are required" },
        { status: 400 }
      );
    }

    const cleanPoints = points.filter(
      (point) =>
        typeof point.lat === "number" &&
        typeof point.lng === "number" &&
        !Number.isNaN(point.lat) &&
        !Number.isNaN(point.lng)
    );

    if (cleanPoints.length < 2) {
      return NextResponse.json(
        { success: false, message: "Invalid route points" },
        { status: 400 }
      );
    }

    const sampledPoints = samplePoints(cleanPoints);

    const coordinates = sampledPoints
      .map((point) => `${point.lng},${point.lat}`)
      .join(";");

    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;

    const response = await fetch(osrmUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          message: "Road route service failed",
          fallbackPoints: cleanPoints,
        },
        { status: 502 }
      );
    }

    const data = await response.json();

    const routeCoordinates = data?.routes?.[0]?.geometry?.coordinates;

    if (!Array.isArray(routeCoordinates)) {
      return NextResponse.json(
        {
          success: false,
          message: "No road route found",
          fallbackPoints: cleanPoints,
        },
        { status: 404 }
      );
    }

    const roadPoints = routeCoordinates.map(
      (coordinate: [number, number]) => ({
        lng: coordinate[0],
        lat: coordinate[1],
      })
    );

    return NextResponse.json({
      success: true,
      points: roadPoints,
    });
  } catch (error) {
    console.error("Road route error:", error);

    return NextResponse.json(
      { success: false, message: "Failed to generate road route" },
      { status: 500 }
    );
  }
}