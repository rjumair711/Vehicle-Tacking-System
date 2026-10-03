-- K-Track: changes to match the project brief.
-- Apply after 001 with: node scripts/apply-sql.mjs prisma/sql/002_project_brief.sql

-- Geofences are polygons drawn on the map and belong to one tracker.
-- (Replaces the circular zones of 001; that table was never used.)
ALTER TABLE alerts DROP COLUMN IF EXISTS geofence_id;
DROP TABLE IF EXISTS geofences;

CREATE TABLE geofences (
  geofence_id    BIGSERIAL PRIMARY KEY,
  tracker_id     VARCHAR(100) NOT NULL REFERENCES trackers(tracker_id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  color          VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
  alert_on_enter BOOLEAN NOT NULL DEFAULT TRUE,
  alert_on_exit  BOOLEAN NOT NULL DEFAULT TRUE,
  area           geometry(Polygon, 4326) NOT NULL,
  created_at     TIMESTAMP(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_geofence_tracker ON geofences (tracker_id);
CREATE INDEX idx_geofence_area ON geofences USING GIST (area);

-- Alerts: coordinates also kept as PostGIS geometry, and the zone that
-- raised a geofence alert.
ALTER TABLE alerts
  ADD COLUMN geofence_id BIGINT REFERENCES geofences(geofence_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);

DROP INDEX IF EXISTS unique_alert_event;
CREATE UNIQUE INDEX unique_alert_event
  ON alerts (tracker_id, type, recorded_at, (COALESCE(geofence_id, 0)));

-- Location sharing: an owner gives another user view-only live access.
CREATE TABLE IF NOT EXISTS tracker_shares (
  share_id       BIGSERIAL PRIMARY KEY,
  tracker_id     VARCHAR(100) NOT NULL REFERENCES trackers(tracker_id) ON DELETE CASCADE,
  viewer_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at     TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_tracker_viewer UNIQUE (tracker_id, viewer_user_id)
);
CREATE INDEX IF NOT EXISTS idx_share_viewer ON tracker_shares (viewer_user_id);
