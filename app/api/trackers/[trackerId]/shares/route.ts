import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_EMAIL, getSession, unauthorized } from "@/lib/auth";
import { generatePassword, hashPassword } from "@/lib/passwords";
import { findOwnedTracker } from "@/lib/trackers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ trackerId: string }> };

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(150),
  name: z.string().trim().max(100).optional(),
});

function trackerNotFound() {
  return NextResponse.json({ message: "Tracker not found" }, { status: 404 });
}

// Location sharing. The owner of a tracker (or the admin) invites a viewer,
// who then sees that vehicle's live location and nothing else.

export async function GET(req: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { trackerId } = await params;
    if (!(await findOwnedTracker(session, trackerId))) return trackerNotFound();

    const shares = await prisma.trackerShare.findMany({
      where: { trackerId },
      include: { viewer: { select: { userId: true, username: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      viewers: shares.map((share) => ({
        id: String(share.viewer.userId),
        name: share.viewer.username,
        email: share.viewer.email,
        since: share.createdAt,
      })),
    });
  } catch (error) {
    console.error("Fetch shares error:", error);
    return NextResponse.json({ message: "Failed to fetch viewers" }, { status: 500 });
  }
}

// Invite by email. If no account has that email, a viewer account is created
// and its generated password is returned once, for the owner to pass on.
export async function POST(req: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { trackerId } = await params;
    const tracker = await findOwnedTracker(session, trackerId);
    if (!tracker) return trackerNotFound();

    const parsed = inviteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Enter a valid email" }, { status: 400 });
    }
    const { email, name } = parsed.data;

    if (email === ADMIN_EMAIL) {
      return NextResponse.json({ message: "The admin already sees every vehicle" }, { status: 400 });
    }

    let viewer = await prisma.user.findUnique({ where: { email } });
    let generatedPassword: string | null = null;

    if (viewer && viewer.userId === tracker.userId) {
      return NextResponse.json({ message: "This person already owns the vehicle" }, { status: 400 });
    }

    if (!viewer) {
      if (!name) {
        return NextResponse.json(
          {
            code: "VIEWER_NAME_REQUIRED",
            message: "No account has this email yet. Enter the viewer's name to create one.",
          },
          { status: 400 }
        );
      }

      generatedPassword = generatePassword();
      viewer = await prisma.user.create({
        data: { username: name, email, passwordHash: await hashPassword(generatedPassword) },
      });
    }

    await prisma.trackerShare.createMany({
      data: [{ trackerId, viewerUserId: viewer.userId }],
      skipDuplicates: true,
    });

    return NextResponse.json(
      {
        success: true,
        viewer: {
          id: String(viewer.userId),
          name: viewer.username,
          email: viewer.email,
          created: generatedPassword !== null,
          password: generatedPassword,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create share error:", error);
    return NextResponse.json({ message: "Failed to share the vehicle" }, { status: 500 });
  }
}

// DELETE /api/trackers/<id>/shares?userId=N - stop sharing with that viewer.
export async function DELETE(req: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { trackerId } = await params;
    if (!(await findOwnedTracker(session, trackerId))) return trackerNotFound();

    const viewerUserId = Number(new URL(req.url).searchParams.get("userId"));
    if (!Number.isInteger(viewerUserId)) {
      return NextResponse.json({ message: "Invalid viewer" }, { status: 400 });
    }

    await prisma.trackerShare.deleteMany({ where: { trackerId, viewerUserId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete share error:", error);
    return NextResponse.json({ message: "Failed to stop sharing" }, { status: 500 });
  }
}
