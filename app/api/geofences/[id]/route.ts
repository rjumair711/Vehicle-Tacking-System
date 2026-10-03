import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { findOwnedTracker, ownedTrackers } from "@/lib/trackers";
import { geofenceSchema, isValidPolygon, listGeofences, toPolygonGeoJson } from "@/lib/geofences";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function notFound() {
  return NextResponse.json({ message: "Geofence not found" }, { status: 404 });
}

export async function PUT(req: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { id } = await params;
    if (!/^\d+$/.test(id)) return notFound();
    const geofenceId = BigInt(id);

    const parsed = geofenceSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid geofence", errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const g = parsed.data;

    // Both the existing zone and the tracker it is (re)assigned to must be the user's.
    const existing = await prisma.geofence.findFirst({
      where: { geofenceId, tracker: ownedTrackers(session) },
      select: { geofenceId: true },
    });
    if (!existing) return notFound();

    if (!(await findOwnedTracker(session, g.trackerId))) {
      return NextResponse.json({ message: "Tracker not found" }, { status: 404 });
    }

    const polygon = toPolygonGeoJson(g.points);
    if (!(await isValidPolygon(polygon))) {
      return NextResponse.json(
        { message: "The zone's edges cross each other. Draw the corners in order around the area." },
        { status: 400 }
      );
    }

    await prisma.$executeRaw`
      UPDATE geofences SET
        tracker_id = ${g.trackerId}, name = ${g.name}, description = ${g.description || null},
        color = ${g.color}, alert_on_enter = ${g.alertOnEnter}, alert_on_exit = ${g.alertOnExit},
        area = ST_SetSRID(ST_GeomFromGeoJSON(${polygon}), 4326)
      WHERE geofence_id = ${geofenceId}
    `;

    const [geofence] = await listGeofences(session, geofenceId);
    return NextResponse.json({ success: true, geofence });
  } catch (error) {
    console.error("Update geofence error:", error);
    return NextResponse.json({ message: "Failed to update geofence" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { id } = await params;
    if (!/^\d+$/.test(id)) return notFound();

    const deleted = await prisma.geofence.deleteMany({
      where: { geofenceId: BigInt(id), tracker: ownedTrackers(session) },
    });
    if (deleted.count === 0) return notFound();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete geofence error:", error);
    return NextResponse.json({ message: "Failed to delete geofence" }, { status: 500 });
  }
}
