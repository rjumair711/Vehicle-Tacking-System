import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { ownedTrackers } from "@/lib/trackers";
import { getUserSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Alerts for the trackers the user owns (all trackers for the admin), newest
// first. Optional ?trackerId=X. Alert types switched off in the user's
// settings are left out.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const trackerId = new URL(req.url).searchParams.get("trackerId") || undefined;

    const settings = await getUserSettings(session.userId);
    const hiddenTypes: string[] = [];
    if (!settings.crashAlerts) hiddenTypes.push("crash");
    if (!settings.geofenceAlerts) hiddenTypes.push("geofence");

    const alerts = await prisma.alert.findMany({
      where: {
        trackerId,
        type: { notIn: hiddenTypes },
        tracker: ownedTrackers(session),
      },
      include: { tracker: { select: { name: true, licensePlate: true } } },
      orderBy: { recordedAt: "desc" },
      take: 500,
    });

    return NextResponse.json({
      success: true,
      alerts: alerts.map((a) => ({
        id: a.alertId.toString(),
        trackerId: a.trackerId,
        trackerName: a.tracker.name,
        licensePlate: a.tracker.licensePlate,
        type: a.type,
        message: a.message,
        latitude: a.latitude,
        longitude: a.longitude,
        speed: a.speed,
        recordedAt: a.recordedAt,
        isResolved: a.isResolved,
        resolvedAt: a.resolvedAt,
        resolvedBy: a.resolvedBy,
      })),
    });
  } catch (error) {
    console.error("Fetch alerts error:", error);
    return NextResponse.json({ message: "Failed to fetch alerts" }, { status: 500 });
  }
}
