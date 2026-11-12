-- Persist the road-matched route of completed trips.
-- Completed trips are immutable, so OSRM matching only
-- has to run once per trip. matched_route_meta holds the
-- inferred index ranges, status, algorithm version and a
-- hash of the GPS points; the app recomputes the match if
-- the hash or version no longer agree.
--
-- Apply with:
--   node scripts/apply-sql.mjs prisma/sql/005_trip_matched_route.sql

ALTER TABLE trip_history
ADD COLUMN IF NOT EXISTS matched_route
geometry(LineString, 4326);

ALTER TABLE trip_history
ADD COLUMN IF NOT EXISTS matched_route_meta JSONB;

ALTER TABLE trip_history
ADD COLUMN IF NOT EXISTS matched_route_at TIMESTAMPTZ;
