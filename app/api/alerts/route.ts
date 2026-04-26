import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const alerts = await prisma.$queryRaw`
      SELECT
        lp.point_id::text AS point_id,
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
      WHERE lp.crash = true
      ORDER BY lp.recorded_at DESC;
    `;

    return NextResponse.json({
      success: true,
      alerts,
    });
  } catch (error) {
    console.error("Fetch alerts error:", error);

    return NextResponse.json(
      { message: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}