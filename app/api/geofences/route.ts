import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { findOwnedTracker } from "@/lib/trackers";
import { geofenceSchema, isValidPolygon, listGeofences, toPolygonGeoJson } from "@/lib/geofences";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    return NextResponse.json({ success: true, geofences: await listGeofences(session) });
  } catch (error) {
    console.error("Fetch geofences error:", error);
    return NextResponse.json({ message: "Failed to fetch geofences" }, { status: 500 });
  }
}

// The admin, or the owner of the tracker, adds a zone drawn on the map.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const parsed = geofenceSchema.safeParse(await req.json());
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      return NextResponse.json(
        {
          message: fields.points
            ? "Draw the zone on the map with at least 3 points"
            : "Name and tracker are required",
          errors: fields,
        },
        { status: 400 }
      );
    }
    const g = parsed.data;

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

    const rows = await prisma.$queryRaw<{ geofence_id: bigint }[]>`
      INSERT INTO geofences (tracker_id, name, description, color, alert_on_enter, alert_on_exit, area)
      VALUES (
        ${g.trackerId}, ${g.name}, ${g.description || null}, ${g.color}, ${g.alertOnEnter}, ${g.alertOnExit},
        ST_SetSRID(ST_GeomFromGeoJSON(${polygon}), 4326)
      )
      RETURNING geofence_id
    `;

    const [geofence] = await listGeofences(session, rows[0].geofence_id);
    return NextResponse.json({ success: true, geofence }, { status: 201 });
  } catch (error) {
    console.error("Create geofence error:", error);
    return NextResponse.json({ message: "Failed to create geofence" }, { status: 500 });
  }
}
