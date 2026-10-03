import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { getTrip, listTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";

// GET /api/trips            -> trip list (no routes; today's trip is "active")
// GET /api/trips?tripId=X   -> one trip with its route as GeoJSON
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const tripId = new URL(req.url).searchParams.get("tripId");

    if (tripId) {
      const trip = await getTrip(session, tripId);
      if (!trip) {
        return NextResponse.json({ message: "Trip not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, trip });
    }

    return NextResponse.json({ success: true, trips: await listTrips(session) });
  } catch (error) {
    console.error("Fetch trips error:", error);
    return NextResponse.json({ message: "Failed to fetch trips" }, { status: 500 });
  }
}
