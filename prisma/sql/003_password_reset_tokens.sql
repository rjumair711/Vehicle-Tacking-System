-- Apply with: node scripts/apply-sql.mjs prisma/sql/003_password_reset_tokens.sql
-- Uses a standalone table so it doesn't alter the existing users schema.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  user_id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens (expires_at);
