import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Where the dashboard gets its live updates: the WebSocket of the backend on
// Render, plus a short-lived ticket that proves who is connecting (the login
// cookie belongs to this site and is not sent to the backend's domain).
//
// BACKEND_URL is the backend's public address, e.g.
// https://k-track-api.onrender.com. Without it the dashboard still works and
// simply re-reads the data every few seconds.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  const backendUrl = (process.env.BACKEND_URL || "").trim().replace(/\/$/, "");
  if (!backendUrl) {
    return NextResponse.json({ url: null, token: null });
  }

  const token = jwt.sign(
    { userId: session.userId, email: session.email, purpose: "realtime" },
    process.env.JWT_SECRET!,
    { expiresIn: "2m" }
  );

  return NextResponse.json(
    { url: `${backendUrl.replace(/^http/, "ws")}/ws`, token },
    { headers: { "Cache-Control": "no-store" } }
  );
}
