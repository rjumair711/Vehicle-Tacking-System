import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { listTrackers } from "@/lib/trackers";

export const dynamic = "force-dynamic";

// Latest position and online status of every tracker the user may see.
// The dashboard and the live map poll this every few seconds.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    return NextResponse.json(
      { success: true, trackers: await listTrackers(session) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Live location error:", error);
    return NextResponse.json({ message: "Failed to fetch live locations" }, { status: 500 });
  }
}
