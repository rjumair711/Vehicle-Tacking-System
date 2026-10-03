import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { ownedTrackers } from "@/lib/trackers";

export const dynamic = "force-dynamic";

// Marks an alert as resolved by the logged-in user.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ alertId: string }> }
) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { alertId } = await params;
    if (!/^\d+$/.test(alertId)) {
      return NextResponse.json({ message: "Invalid alert ID" }, { status: 400 });
    }

    const updated = await prisma.alert.updateMany({
      where: { alertId: BigInt(alertId), tracker: ownedTrackers(session) },
      data: { isResolved: true, resolvedAt: new Date(), resolvedBy: session.email },
    });

    if (updated.count === 0) {
      return NextResponse.json({ message: "Alert not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, resolvedBy: session.email });
  } catch (error) {
    console.error("Resolve alert error:", error);
    return NextResponse.json({ message: "Failed to resolve alert" }, { status: 500 });
  }
}
