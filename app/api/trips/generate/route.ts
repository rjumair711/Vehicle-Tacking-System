import { NextResponse } from "next/server";
import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { rollUpFinishedDays } from "@/lib/trips";

export const dynamic = "force-dynamic";

// Admin: roll finished days into trip history now. The trips list does this
// by itself on every load, so calling it is optional.
export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  try {
    const trips = await rollUpFinishedDays();

    return NextResponse.json({
      success: true,
      message: "Trip history generated successfully",
      trips,
    });
  } catch (error) {
    console.error("Generate trips error:", error);
    return NextResponse.json({ message: "Failed to generate trip history" }, { status: 500 });
  }
}
