
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, unauthorized } from '@/lib/auth';
import { findOwnedTracker } from '@/lib/trackers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
  params: Promise<{
    trackerId: string;
    linkId: string;
  }>;
};

export async function DELETE(
  _request: Request,
  { params }: Context
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { trackerId, linkId } = await params;

  const tracker = await findOwnedTracker(session, trackerId);

  if (!tracker) {
    return NextResponse.json(
      { message: 'Tracker not found' },
      { status: 404 }
    );
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(linkId)) {
    return NextResponse.json(
      { message: 'Invalid link ID' },
      { status: 400 }
    );
  }

  try {
    const count = await prisma.$executeRaw`
      UPDATE tracker_share_links
      SET revoked_at = NOW()
      WHERE id = ${linkId}::uuid
        AND tracker_id = ${trackerId}
        AND owner_user_id = ${tracker.userId}
        AND revoked_at IS NULL
    `;

    if (!count) {
      return NextResponse.json(
        { message: 'Link not found or already revoked' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, message: 'Sharing link revoked' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Revoke sharing link:', error);

    return NextResponse.json(
      { message: 'Failed to revoke sharing link' },
      { status: 500 }
    );
  }
}
