import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const latestPoints = await prisma.$queryRaw`
      SELECT DISTINCT ON (lp.tracker_id)
        lp.tracker_id,
        t.name,
        t.license_plate,
        lp.longitude,
        lp.latitude,
        lp.speed,
        lp.crash,
        lp.recorded_at
      FROM location_points lp
      JOIN trackers t ON t.tracker_id = lp.tracker_id
      ORDER BY lp.tracker_id, lp.recorded_at DESC;
    `;

    return NextResponse.json({
      success: true,
      locations: latestPoints,
    });
  } catch (error) {
    console.error("Live location error:", error);

    return NextResponse.json(
      { message: "Failed to fetch live locations" },
      { status: 500 }
    );
  }
}