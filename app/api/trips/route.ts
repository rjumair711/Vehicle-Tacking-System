
import { NextResponse } from 'next/server';
import { getSession, unauthorized } from '@/lib/auth';
import { getTrip, listTrips } from '@/lib/trips';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// First view of a trip may road-match it through the
// throttled public OSRM server (budget ~50 s).
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getSession();

  if (!session) {
    return unauthorized();
  }

  try {
    const { searchParams } = new URL(req.url);
    const tripId = searchParams.get('tripId');

    // Single trip with detailed GPS road matching.
    if (tripId) {
      const trip = await getTrip(session, tripId);

      if (!trip) {
        return NextResponse.json(
          {
            success: false,
            message: 'Trip not found'
          },
          { status: 404 }
        );
      }

      const start = new Date(trip.start_time);
      const end = new Date(trip.end_time);

      const duration = Math.max(
        0,
        Math.round(
          (end.getTime() - start.getTime()) / 60000
        )
      );

      return NextResponse.json(
        {
          success: true,
          trip: {
            // Preserve original DB fields.
            ...trip,

            // Frontend-compatible properties.
            id: trip.trip_id,
            trackerId: trip.tracker_id,
            trackerName: trip.name,
            licensePlate: trip.license_plate,

            startTime: trip.start_time,
            endTime: trip.end_time,

            distance: trip.total_distance ?? 0,
            duration,

            averageSpeed: trip.average_speed ?? 0,
            maxSpeed: trip.max_speed ?? 0,

            status: trip.status,

            routeGeoJson: trip.route_geojson,

            // One continuous [lng, lat] line, plus the
            // index ranges that are estimated connectors
            // rather than road-matched GPS.
            routeLine: trip.route_line,
            inferredRanges: trip.inferred_ranges,
            roadMatchConfigured: trip.road_match_configured,

            // Road matching result.
            roadSegments: trip.road_segments,
            gpsSegments: trip.gps_segments,
            roadMatchStatus: trip.road_match_status,
            gpsPointsCount: trip.gps_points_count,

            // Also preserve snake_case for the
            // existing TripRouteLayer component.
            road_segments: trip.road_segments,
            gps_segments: trip.gps_segments,
            road_match_status: trip.road_match_status,
            gps_points_count: trip.gps_points_count
          }
        },
        {
          headers: {
            'Cache-Control':
              'private, no-store, max-age=0'
          }
        }
      );
    }

    // Keep the existing list response unchanged.
    const trips = await listTrips(session);

    return NextResponse.json(
      {
        success: true,
        trips
      },
      {
        headers: {
          'Cache-Control':
            'private, no-store, max-age=0'
        }
      }
    );
  } catch (error) {
    console.error('Fetch trips error:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to fetch trips'
      },
      { status: 500 }
    );
  }
}
