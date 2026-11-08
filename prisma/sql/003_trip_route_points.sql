
CREATE EXTENSION IF NOT EXISTS postgis;

-- Preserve GPS observations needed for trip reconstruction.
CREATE TABLE IF NOT EXISTS trip_route_points (
  tracker_id TEXT NOT NULL,
  trip_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  speed_kmh DOUBLE PRECISION NOT NULL,
  location geometry(Point, 4326) NOT NULL,

  PRIMARY KEY (tracker_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_trip_route_points_day
ON trip_route_points (
  tracker_id,
  trip_date,
  recorded_at
);

CREATE INDEX IF NOT EXISTS idx_location_points_recorded_at
ON location_points (recorded_at);

-- Protect old trips that do not have a complete
-- timestamped GPS archive.
ALTER TABLE trip_history
ADD COLUMN IF NOT EXISTS route_archive_v2
BOOLEAN NOT NULL DEFAULT FALSE;
