import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    await prisma.$executeRaw`
      INSERT INTO trip_history (
        tracker_id,
        trip_date,
        start_time,
        end_time,
        total_distance,
        average_speed,
        route
      )
      SELECT
        tracker_id,
        DATE(recorded_at) AS trip_date,
        MIN(recorded_at) AS start_time,
        MAX(recorded_at) AS end_time,
        0 AS total_distance,
        AVG(speed) AS average_speed,
        ST_MakeLine(location ORDER BY recorded_at) AS route
      FROM location_points
      GROUP BY tracker_id, DATE(recorded_at)
      ON CONFLICT (tracker_id, trip_date)
      DO NOTHING;
    `;

    return NextResponse.json({
      success: true,
      message: "Trip history generated successfully",
    });
  } catch (error) {
    console.error("Generate trips error:", error);

    return NextResponse.json(
      { message: "Failed to generate trip history" },
      { status: 500 }
    );
  }
}