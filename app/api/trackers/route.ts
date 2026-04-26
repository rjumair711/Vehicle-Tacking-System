import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

const createTrackerSchema = z.object({
  trackerId: z.string().min(2),
  userId: z.number(),
  secretToken: z.string().min(4),
  name: z.string().optional(),
  licensePlate: z.string().optional(),
  status: z.string().optional(),
});

export async function GET() {
  try {
    const trackers = await prisma.tracker.findMany({
      include: {
        user: {
          select: {
            userId: true,
            username: true,
            email: true,
          },
        },
      },
      orderBy: {
        trackerId: "asc",
      },
    });

    return NextResponse.json({ trackers });
  } catch (error) {
    console.error("Fetch trackers error:", error);
    return NextResponse.json(
      { message: "Failed to fetch trackers" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = createTrackerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid input", errors: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      trackerId,
      userId,
      secretToken,
      name,
      licensePlate,
      status = "ACTIVE",
    } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      return NextResponse.json(
        { message: "User/customer not found" },
        { status: 404 }
      );
    }

    const existingTracker = await prisma.tracker.findUnique({
      where: { trackerId },
    });

    if (existingTracker) {
      return NextResponse.json(
        { message: "Tracker already exists" },
        { status: 409 }
      );
    }

    const secretTokenHash = await bcrypt.hash(secretToken, 10);

    const tracker = await prisma.tracker.create({
      data: {
        trackerId,
        userId,
        secretTokenHash,
        name,
        licensePlate,
        status,
      },
    });

    return NextResponse.json(
      {
        message: "Tracker created successfully",
        tracker,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create tracker error:", error);
    return NextResponse.json(
      { message: "Failed to create tracker" },
      { status: 500 }
    );
  }
}