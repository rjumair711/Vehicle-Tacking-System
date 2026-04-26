import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

const trackerDataSchema = z.object({
  tracker_id: z.string().min(1),
  token: z.string().min(1),
  longitude: z.number(),
  latitude: z.number(),
  speed: z.number(),
  timestamp: z.string(),
  crash: z.boolean().default(false),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = trackerDataSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid tracker data", errors: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      tracker_id,
      token,
      longitude,
      latitude,
      speed,
      timestamp,
      crash,
    } = parsed.data;

    const tracker = await prisma.tracker.findUnique({
      where: {
        trackerId: tracker_id,
      },
      include: {
        user: true,
      },
    });

    if (!tracker) {
      return NextResponse.json(
        { message: "Tracker not registered" },
        { status: 404 }
      );
    }

    if (tracker.status !== "ACTIVE") {
      return NextResponse.json(
        { message: "Tracker is not active" },
        { status: 403 }
      );
    }

    const isValidToken = await bcrypt.compare(
      token,
      tracker.secretTokenHash
    );

    if (!isValidToken) {
      return NextResponse.json(
        { message: "Invalid tracker token" },
        { status: 401 }
      );
    }

    const recordedAt = new Date(timestamp);

    if (isNaN(recordedAt.getTime())) {
      return NextResponse.json(
        { message: "Invalid timestamp" },
        { status: 400 }
      );
    }

    // Insert normal fields + PostGIS point using raw SQL
    await prisma.$executeRaw`
      INSERT INTO location_points (
        tracker_id,
        longitude,
        latitude,
        speed,
        crash,
        recorded_at,
        location
      )
      VALUES (
        ${tracker_id},
        ${longitude},
        ${latitude},
        ${speed},
        ${crash},
        ${recordedAt},
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
      )
    `;

    return NextResponse.json({
      message: "Tracker data received successfully",
      userId: tracker.userId,
      trackerId: tracker.trackerId,
      liveData: {
        longitude,
        latitude,
        speed,
        timestamp: recordedAt,
        crash,
      },
    });
  } catch (error) {
    console.error("Tracker data ingestion error:", error);

    return NextResponse.json(
      { message: "Failed to process tracker data" },
      { status: 500 }
    );
  }
}