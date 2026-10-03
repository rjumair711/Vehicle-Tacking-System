import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { MIN_DEVICE_TOKEN_LENGTH, hashDeviceToken } from "@/lib/deviceAuth";
import { listTrackers } from "@/lib/trackers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ trackerId: string }> };

const updateTrackerSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  licensePlate: z.string().trim().max(50).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  userId: z.number().int().optional(),
  secretToken: z.string().trim().min(MIN_DEVICE_TOKEN_LENGTH).max(200).optional(),
});

export async function GET(req: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { trackerId } = await params;
    const tracker = (await listTrackers(session)).find((t) => t.trackerId === trackerId);

    if (!tracker) {
      return NextResponse.json({ message: "Tracker not found" }, { status: 404 });
    }

    return NextResponse.json({ tracker });
  } catch (error) {
    console.error("Fetch tracker error:", error);
    return NextResponse.json({ message: "Failed to fetch tracker" }, { status: 500 });
  }
}

// Admin: rename, suspend/reactivate, move to another customer, replace the token.
export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  try {
    const { trackerId } = await params;
    const parsed = updateTrackerSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid input", errors: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, licensePlate, status, userId, secretToken } = parsed.data;

    const existing = await prisma.tracker.findUnique({ where: { trackerId } });
    if (!existing) {
      return NextResponse.json({ message: "Tracker not found" }, { status: 404 });
    }

    if (userId !== undefined) {
      const user = await prisma.user.findUnique({ where: { userId } });
      if (!user) {
        return NextResponse.json({ message: "Customer not found" }, { status: 404 });
      }
    }

    await prisma.tracker.update({
      where: { trackerId },
      data: {
        name,
        licensePlate: licensePlate === undefined ? undefined : licensePlate || null,
        status,
        userId,
        secretTokenHash: secretToken ? await hashDeviceToken(secretToken) : undefined,
      },
    });

    return NextResponse.json({ message: "Tracker updated successfully" });
  } catch (error) {
    console.error("Update tracker error:", error);
    return NextResponse.json({ message: "Failed to update tracker" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  try {
    const { trackerId } = await params;

    const existing = await prisma.tracker.findUnique({ where: { trackerId } });
    if (!existing) {
      return NextResponse.json({ message: "Tracker not found" }, { status: 404 });
    }

    await prisma.tracker.delete({ where: { trackerId } });

    return NextResponse.json({ message: "Tracker deleted successfully" });
  } catch (error) {
    console.error("Delete tracker error:", error);
    return NextResponse.json({ message: "Failed to delete tracker" }, { status: 500 });
  }
}
