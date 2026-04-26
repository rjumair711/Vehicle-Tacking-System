import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const trips = await prisma.$queryRaw`
      SELECT
        th.trip_id,
        th.tracker_id,
        t.name,
        t.license_plate,
        th.trip_date,
        th.start_time,
        th.end_time,
        th.total_distance,
        th.average_speed,
        ST_AsGeoJSON(th.route) AS route_geojson
      FROM trip_history th
      JOIN trackers t ON t.tracker_id = th.tracker_id
      ORDER BY th.trip_date DESC, th.start_time DESC;
    `;

    return NextResponse.json({
      success: true,
      trips,
    });
  } catch (error) {
    console.error("Fetch trips error:", error);

    return NextResponse.json(
      { message: "Failed to fetch trips" },
      { status: 500 }
    );
  }
}