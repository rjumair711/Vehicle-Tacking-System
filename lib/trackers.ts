import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Session } from '@/lib/auth';

// The tracker sends a record every 5 s while it has a GPS fix and a
// connection. It counts as online if anything arrived in this window.
export const ONLINE_WINDOW_MS = 90 * 1000;

// Trackers whose trips, alerts and geofences the user may see and manage:
// all of them for the admin, only their own for a vehicle owner. A tracker
// shared with an invited viewer is NOT included - viewers get live location
// only (see listTrackers).
export function ownedTrackers(session: Session): Prisma.TrackerWhereInput {
  return session.isAdmin ? {} : { userId: session.userId };
}

// The same rule for raw PostGIS queries that join trackers as "t".
export function ownerFilter(session: Session, column = Prisma.sql`t.user_id`) {
  return session.isAdmin ? Prisma.sql`TRUE` : Prisma.sql`${column} = ${session.userId}`;
}

export async function findOwnedTracker(session: Session, trackerId: string) {
  return prisma.tracker.findFirst({
    where: { trackerId, ...ownedTrackers(session) },
  });
}

// Live view: own trackers plus trackers shared with this user (view-only).
export async function listTrackers(session: Session) {
  const rows = await prisma.tracker.findMany({
    where: session.isAdmin
      ? {}
      : {
          OR: [
            { userId: session.userId },
            { shares: { some: { viewerUserId: session.userId } } },
          ],
        },
    include: { user: { select: { userId: true, username: true, email: true } } },
    orderBy: { trackerId: 'asc' },
  });

  const now = Date.now();

  return rows.map((row) => {
    const active = row.status === 'ACTIVE';
    const online =
      active &&
      row.lastReceivedAt !== null &&
      now - row.lastReceivedAt.getTime() <= ONLINE_WINDOW_MS;
    const shared = !session.isAdmin && row.userId !== session.userId;

    return {
      trackerId: row.trackerId,
      name: row.name,
      licensePlate: row.licensePlate,
      status: !active ? 'suspended' : online ? 'online' : 'offline',
      shared,
      // A viewer is told who shared the vehicle, but not the owner's email.
      customer: shared
        ? { id: '', name: row.user.username, email: '' }
        : { id: String(row.user.userId), name: row.user.username, email: row.user.email },
      lastSeen: row.lastReceivedAt,
      createdAt: row.createdAt,
      location:
        row.lastLatitude !== null && row.lastLongitude !== null
          ? {
              lat: row.lastLatitude,
              lng: row.lastLongitude,
              speed: row.lastSpeed ?? 0,
              timestamp: row.lastRecordedAt,
            }
          : null,
    };
  });
}

// ADMIN, USER (vehicle owner) or VIEWER (owns no tracker and has at least
// one vehicle shared with them: live map only).
export async function getUserRole(session: Session): Promise<'ADMIN' | 'USER' | 'VIEWER'> {
  if (session.isAdmin) return 'ADMIN';

  const [owned, shared] = await Promise.all([
    prisma.tracker.count({ where: { userId: session.userId } }),
    prisma.trackerShare.count({ where: { viewerUserId: session.userId } }),
  ]);

  return owned === 0 && shared > 0 ? 'VIEWER' : 'USER';
}
