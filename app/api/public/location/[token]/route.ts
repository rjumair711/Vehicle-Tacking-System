
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = {
  params: Promise<{ token: string }>;
};

type PublicLocationRow = {
  tracker_id: string;
  name: string | null;
  license_plate: string | null;
  status: string | null;
  last_latitude: number | null;
  last_longitude: number | null;
  last_recorded_at: Date | null;
  last_received_at: Date | null;
  allow_live: boolean;
  snapshot_latitude: number | null;
  snapshot_longitude: number | null;
  snapshot_recorded_at: Date | null;
  expires_at: Date;
};

const headers = {
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(
  _request: Request,
  { params }: Context
) {
  const { token } = await params;

  // Validate before querying the database.
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return NextResponse.json(
      { message: 'Invalid or expired sharing link' },
      { status: 404, headers }
    );
  }

  const tokenHash = createHash('sha256')
    .update(token)
    .digest('hex');

  try {
    const rows = await prisma.$queryRaw<PublicLocationRow[]>`
      SELECT
        t.tracker_id,
        t.name,
        t.license_plate,
        t.status,
        t.last_latitude,
        t.last_longitude,
        t.last_recorded_at,
        t.last_received_at,
        sl.allow_live,
        sl.snapshot_latitude,
        sl.snapshot_longitude,
        sl.snapshot_recorded_at,
        sl.expires_at
      FROM tracker_share_links sl
      JOIN trackers t
        ON t.tracker_id = sl.tracker_id
      WHERE sl.token_hash = ${tokenHash}
        AND sl.revoked_at IS NULL
        AND sl.expires_at > NOW()
        AND sl.owner_user_id = t.user_id
      LIMIT 1
    `;

    const row = rows[0];

    if (!row) {
      return NextResponse.json(
        { message: 'This link has expired or been revoked' },
        { status: 404, headers }
      );
    }

    // Live links use the current last-known position.
    // Static links use the snapshot taken at creation.
    const latitude = row.allow_live
      ? row.last_latitude
      : row.snapshot_latitude;

    const longitude = row.allow_live
      ? row.last_longitude
      : row.snapshot_longitude;

    const recordedAt = row.allow_live
      ? row.last_recorded_at
      : row.snapshot_recorded_at;

    // Trackers count as online when telemetry has been
    // received in the last 90 seconds.
    const isOnline =
      row.allow_live &&
      row.status === 'ACTIVE' &&
      row.last_received_at !== null &&
      Date.now() -
        new Date(row.last_received_at).getTime() <= 90000;

    return NextResponse.json(
      {
        vehicle: {
          name: row.name ?? 'Vehicle',
          licensePlate: row.license_plate,
        },
        location:
          latitude !== null &&
          longitude !== null &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180
            ? {
                latitude,
                longitude,
                recordedAt,
              }
            : null,
        online: isOnline,
        allowLive: row.allow_live,
        expiresAt: row.expires_at,
      },
      { headers }
    );
  } catch (error) {
    console.error('Public location lookup failed:', error);

    return NextResponse.json(
      { message: 'Unable to load shared location' },
      { status: 500, headers }
    );
  }
}
