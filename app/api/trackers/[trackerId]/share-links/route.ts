
import { NextResponse } from 'next/server';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSession, unauthorized } from '@/lib/auth';
import { findOwnedTracker } from '@/lib/trackers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
  params: Promise<{ trackerId: string }>;
};

type ShareLinkRow = {
  id: string;
  tracker_id: string;
  allow_live: boolean;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

const createSchema = z.object({
  durationMinutes: z.union([
    z.literal(15),
    z.literal(60),
    z.literal(1440),
  ]),
  allowLive: z.boolean().default(true),
});

const noStore = {
  'Cache-Control': 'private, no-store',
};

export async function GET(
  _request: Request,
  { params }: Context
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { trackerId } = await params;

  const tracker = await findOwnedTracker(session, trackerId);

  if (!tracker) {
    return NextResponse.json(
      { message: 'Tracker not found' },
      { status: 404 }
    );
  }

  try {
    const rows = await prisma.$queryRaw<ShareLinkRow[]>`
      SELECT
        id::text,
        tracker_id,
        allow_live,
        created_at,
        expires_at,
        revoked_at
      FROM tracker_share_links
      WHERE tracker_id = ${trackerId}
        AND owner_user_id = ${tracker.userId}
      ORDER BY created_at DESC
      LIMIT 100
    `;

    return NextResponse.json(
      {
        links: rows.map((row) => ({
          id: row.id,
          allowLive: row.allow_live,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
          active:
            !row.revoked_at &&
            new Date(row.expires_at).getTime() > Date.now(),
        })),
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error('List sharing links:', error);

    return NextResponse.json(
      { message: 'Failed to load sharing links' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: Context
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { trackerId } = await params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid request' },
      { status: 400 }
    );
  }

  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid sharing options' },
      { status: 400 }
    );
  }

  try {
    // Generate a cryptographically random bearer token.
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256')
      .update(token)
      .digest('hex');

    const id = randomUUID();
    const { durationMinutes, allowLive } = parsed.data;

    const expiresAt = new Date(
      Date.now() + durationMinutes * 60 * 1000
    );

    // Check ownership again inside the INSERT so a concurrent
    // ownership change cannot create a link for the old owner.
    const result = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO tracker_share_links (
        id,
        tracker_id,
        owner_user_id,
        token_hash,
        allow_live,
        snapshot_latitude,
        snapshot_longitude,
        snapshot_recorded_at,
        expires_at
      )
      SELECT
        ${id}::uuid,
        t.tracker_id,
        t.user_id,
        ${tokenHash},
        ${allowLive},
        t.last_latitude,
        t.last_longitude,
        t.last_recorded_at,
        ${expiresAt}
      FROM trackers t
      WHERE t.tracker_id = ${trackerId}
        AND (
          ${session.isAdmin}
          OR t.user_id = ${session.userId}
        )
      RETURNING id::text
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { message: 'Tracker not found or access denied' },
        { status: 404 }
      );
    }

    const origin = (process.env.APP_URL || '').replace(/\/$/, '');

    if (!origin || !origin.startsWith('https://')) {
      // Do not leave an active link if configuration is missing.
      await prisma.$executeRaw`
        DELETE FROM tracker_share_links WHERE id = ${id}::uuid
      `;

      return NextResponse.json(
        { message: 'APP_URL must be configured with an HTTPS URL' },
        { status: 500 }
      );
    }

    const url = `${origin}/share/${token}`;

    return NextResponse.json(
      {
        success: true,
        link: {
          id,
          url,
          expiresAt,
          allowLive,
        },
      },
      {
        status: 201,
        headers: noStore,
      }
    );
  } catch (error) {
    console.error('Create sharing link:', error);

    return NextResponse.json(
      { message: 'Failed to create sharing link' },
      { status: 500 }
    );
  }
}
