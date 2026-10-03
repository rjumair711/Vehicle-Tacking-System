import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Session } from '@/lib/auth';
import { ownerFilter } from '@/lib/trackers';

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const geofenceSchema = z.object({
  trackerId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  alertOnEnter: z.boolean(),
  alertOnExit: z.boolean(),
  // Corners of the zone in the order they were drawn on the map.
  points: z.array(pointSchema).min(3).max(200),
});

export type GeofenceInput = z.infer<typeof geofenceSchema>;

// GeoJSON polygon (WGS84, longitude first) with the ring closed.
export function toPolygonGeoJson(points: GeofenceInput['points']): string {
  const ring = points.map((p) => [p.lng, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);

  return JSON.stringify({ type: 'Polygon', coordinates: [ring] });
}

// A shape whose edges cross themselves is not a usable zone.
export async function isValidPolygon(polygonGeoJson: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ valid: boolean }[]>`
    SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(${polygonGeoJson}), 4326)) AS valid
  `;
  return rows[0]?.valid === true;
}

interface GeofenceRow {
  geofence_id: string;
  tracker_id: string;
  tracker_name: string | null;
  name: string;
  description: string | null;
  color: string;
  alert_on_enter: boolean;
  alert_on_exit: boolean;
  created_at: Date;
  area_geojson: string;
}

// Geofences of the trackers the user owns (all of them for the admin).
export async function listGeofences(session: Session, geofenceId?: bigint) {
  const only = geofenceId === undefined ? Prisma.sql`TRUE` : Prisma.sql`g.geofence_id = ${geofenceId}`;

  const rows = await prisma.$queryRaw<GeofenceRow[]>`
    SELECT
      g.geofence_id::text AS geofence_id, g.tracker_id, t.name AS tracker_name,
      g.name, g.description, g.color, g.alert_on_enter, g.alert_on_exit, g.created_at,
      ST_AsGeoJSON(g.area) AS area_geojson
    FROM geofences g
    JOIN trackers t ON t.tracker_id = g.tracker_id
    WHERE ${ownerFilter(session)} AND ${only}
    ORDER BY g.created_at
  `;

  return rows.map((row) => {
    const ring: number[][] = JSON.parse(row.area_geojson).coordinates[0];

    return {
      id: row.geofence_id,
      trackerId: row.tracker_id,
      trackerName: row.tracker_name,
      name: row.name,
      description: row.description ?? '',
      color: row.color,
      alertOnEnter: row.alert_on_enter,
      alertOnExit: row.alert_on_exit,
      createdAt: row.created_at,
      // without the closing point, which repeats the first
      points: ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng })),
    };
  });
}
