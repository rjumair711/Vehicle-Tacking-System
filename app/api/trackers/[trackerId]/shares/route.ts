
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ADMIN_EMAIL,
  getSession,
  unauthorized,
} from '@/lib/auth';
import { findOwnedTracker } from '@/lib/trackers';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ trackerId: string }>;
};

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(150),
});

function notFound() {
  return NextResponse.json(
    { message: 'Tracker not found' },
    { status: 404 }
  );
}

export async function GET(
  _request: Request,
  { params }: RouteContext
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { trackerId } = await params;

  if (!(await findOwnedTracker(session, trackerId))) {
    return notFound();
  }

  try {
    const shares = await prisma.trackerShare.findMany({
      where: { trackerId },
      include: {
        viewer: {
          select: {
            userId: true,
            username: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
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
    console.error('Fetch shares error:', error);

    return NextResponse.json(
      { message: 'Failed to fetch viewers' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { trackerId } = await params;

  const tracker = await findOwnedTracker(session, trackerId);

  if (!tracker) return notFound();

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid JSON' },
      { status: 400 }
    );
  }

  const parsed = inviteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Enter a valid email address' },
      { status: 400 }
    );
  }

  const { email } = parsed.data;

  if (email === ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.json(
      { message: 'Administrator already has vehicle access' },
      { status: 400 }
    );
  }

  try {
    const viewer = await prisma.user.findUnique({
      where: { email },
    });

    if (!viewer) {
      return NextResponse.json(
        {
          message:
            'This person does not have a FleetTrack account. Use Create Location Link instead.',
        },
        { status: 404 }
      );
    }

    if (viewer.userId === tracker.userId) {
      return NextResponse.json(
        { message: 'This user already owns the vehicle' },
        { status: 400 }
      );
    }

    // Ensure the tracker still belongs to this owner.
    // If it was transferred meanwhile, do not create a share.
    const currentTracker = await findOwnedTracker(
      session,
      trackerId
    );

    if (
      !currentTracker ||
      currentTracker.userId !== tracker.userId
    ) {
      return notFound();
    }

    await prisma.trackerShare.createMany({
      data: [
        {
          trackerId,
          viewerUserId: viewer.userId,
        },
      ],
      skipDuplicates: true,
    });

    return NextResponse.json(
      {
        success: true,
        viewer: {
          id: String(viewer.userId),
          name: viewer.username,
          email: viewer.email,
          created: false,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create share error:', error);

    return NextResponse.json(
      { message: 'Failed to share vehicle' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: RouteContext
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { trackerId } = await params;

  if (!(await findOwnedTracker(session, trackerId))) {
    return notFound();
  }

  const value = new URL(request.url).searchParams.get('userId');

  if (!value || !/^[1-9]\d*$/.test(value)) {
    return NextResponse.json(
      { message: 'Invalid viewer ID' },
      { status: 400 }
    );
  }

  const viewerUserId = Number(value);

  if (!Number.isSafeInteger(viewerUserId)) {
    return NextResponse.json(
      { message: 'Invalid viewer ID' },
      { status: 400 }
    );
  }

  try {
    await prisma.trackerShare.deleteMany({
      where: {
        trackerId,
        viewerUserId,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Viewer access removed',
    });
  } catch (error) {
    console.error('Remove viewer error:', error);

    return NextResponse.json(
      { message: 'Failed to remove viewer' },
      { status: 500 }
    );
  }
}
