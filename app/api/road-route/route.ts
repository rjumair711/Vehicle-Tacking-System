import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { OSRM_BASE_URL, osrmGet } from "@/lib/osrm";

export const runtime = "nodejs";

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
  // Logged-in users only: this endpoint forwards
  // coordinates to an OSRM server.
  const session = await getSession();
  if (!session) return unauthorized();

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

    // Same rule as trip matching: OSRM_MATCH_BASE_URL, or
    // the public demo only with ALLOW_PUBLIC_OSRM=true.
    if (!OSRM_BASE_URL) {
      return NextResponse.json(
        {
          success: false,
          message: "Road routing is not configured",
          fallbackPoints: cleanPoints,
        },
        { status: 503 }
      );
    }

    const sampledPoints = samplePoints(cleanPoints);

    const coordinates = sampledPoints
      .map((point) => `${point.lng},${point.lat}`)
      .join(";");

    // Throttled, with User-Agent and one retry (lib/osrm.ts).
    const { status, body: data } = await osrmGet<{
      routes?: Array<{ geometry?: { coordinates?: unknown } }>;
    }>(
      `route/v1/driving/${coordinates}?overview=full&geometries=geojson`,
      { deadline: Date.now() + 15000 }
    );

    if (status < 200 || status >= 300) {
      return NextResponse.json(
        {
          success: false,
          message: "Road route service failed",
          fallbackPoints: cleanPoints,
        },
        { status: 502 }
      );
    }

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