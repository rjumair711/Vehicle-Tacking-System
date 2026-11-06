
CREATE TABLE IF NOT EXISTS tracker_share_links (
  id UUID PRIMARY KEY,
  tracker_id VARCHAR(100) NOT NULL
    REFERENCES trackers(tracker_id) ON DELETE CASCADE,
  owner_user_id INTEGER NOT NULL
    REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  allow_live BOOLEAN NOT NULL DEFAULT TRUE,
  snapshot_latitude DOUBLE PRECISION,
  snapshot_longitude DOUBLE PRECISION,
  snapshot_recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_share_links_tracker
ON tracker_share_links(tracker_id);

CREATE INDEX IF NOT EXISTS idx_share_links_expiry
ON tracker_share_links(expires_at);
