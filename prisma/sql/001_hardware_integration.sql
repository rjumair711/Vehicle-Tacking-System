-- K-Track: schema changes for real hardware integration.
-- Additive and idempotent. Apply with: node scripts/apply-sql.mjs prisma/sql/001_hardware_integration.sql
-- (schema is managed with raw SQL on Neon - do NOT run `prisma migrate dev`).

-- Customers: company name shown on the Customers page.
ALTER TABLE users ADD COLUMN IF NOT EXISTS company VARCHAR(150);

-- Trackers: last known position, kept on the tracker row so the live map
-- still works after the day's raw points are rolled up into a trip.
ALTER TABLE trackers
  ADD COLUMN IF NOT EXISTS last_longitude   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_latitude    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_speed       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_recorded_at TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMP(6) NOT NULL DEFAULT NOW();

-- Location points: the tracker re-sends a buffered record when a reply is
-- lost, so the same (tracker, time) must be stored once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_point_tracker_time') THEN
    ALTER TABLE location_points
      ADD CONSTRAINT unique_point_tracker_time UNIQUE (tracker_id, recorded_at);
  END IF;
END $$;

-- Trips: top speed of the day.
ALTER TABLE trip_history ADD COLUMN IF NOT EXISTS max_speed DOUBLE PRECISION DEFAULT 0;

-- The old trigger deleted a whole UTC day of points when a trip row was
-- inserted. Trips are now cut on local (Pakistan) days and the roll-up query
-- removes the points itself, so the trigger only clears the trip's own span.
CREATE OR REPLACE FUNCTION delete_processed_location_points()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    DELETE FROM location_points
    WHERE tracker_id = NEW.tracker_id
      AND recorded_at >= NEW.start_time
      AND recorded_at <= NEW.end_time;

    RETURN NEW;
END;
$function$;

-- Geofences (circular zones, managed by the admin).
CREATE TABLE IF NOT EXISTS geofences (
  geofence_id      BIGSERIAL PRIMARY KEY,
  name             VARCHAR(100) NOT NULL,
  description      TEXT,
  center_longitude DOUBLE PRECISION NOT NULL,
  center_latitude  DOUBLE PRECISION NOT NULL,
  radius_m         DOUBLE PRECISION NOT NULL,
  type             VARCHAR(20) NOT NULL DEFAULT 'inclusion',
  color            VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
  alert_on_enter   BOOLEAN NOT NULL DEFAULT FALSE,
  alert_on_exit    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

-- Alerts: stored on their own so they outlive the raw points and can be
-- resolved. type is 'crash' or 'geofence'.
CREATE TABLE IF NOT EXISTS alerts (
  alert_id    BIGSERIAL PRIMARY KEY,
  tracker_id  VARCHAR(100) NOT NULL REFERENCES trackers(tracker_id) ON DELETE CASCADE,
  type        VARCHAR(20) NOT NULL,
  message     TEXT NOT NULL,
  longitude   DOUBLE PRECISION,
  latitude    DOUBLE PRECISION,
  speed       DOUBLE PRECISION,
  recorded_at TIMESTAMP(6) NOT NULL,
  geofence_id BIGINT REFERENCES geofences(geofence_id) ON DELETE SET NULL,
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMP(6),
  resolved_by VARCHAR(150)
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_alert_event
  ON alerts (tracker_id, type, recorded_at, (COALESCE(geofence_id, 0)));
CREATE INDEX IF NOT EXISTS idx_alert_tracker_time ON alerts (tracker_id, recorded_at DESC);

-- Per-user settings.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id         INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  crash_alerts    BOOLEAN NOT NULL DEFAULT TRUE,
  geofence_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  theme           VARCHAR(20) NOT NULL DEFAULT 'dark',
  speed_unit      VARCHAR(10) NOT NULL DEFAULT 'km/h',
  updated_at      TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

-- OTA firmware images (Vercel has no persistent disk, so the .bin lives here).
CREATE TABLE IF NOT EXISTS firmware_releases (
  version     VARCHAR(32) PRIMARY KEY,
  filename    VARCHAR(64) NOT NULL UNIQUE,
  size        INTEGER NOT NULL,
  sha256      CHAR(64) NOT NULL,
  data        BYTEA NOT NULL,
  uploaded_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
);
