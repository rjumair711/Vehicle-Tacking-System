/**
 * K-Track backend: tracker ingest + OTA host + live push to the dashboard
 * (plain HTTP, behind a TLS-terminating edge)
 * ------------------------------------------------------------
 * Runs on Render (or behind a VS Code dev tunnel while testing). It is the
 * only thing the tracker talks to. The dashboard itself is the Next.js app
 * on Vercel; both use the same PostgreSQL/PostGIS database on Neon.
 *
 *   Tracker --HTTPS--> this process --SQL--> Neon <--SQL-- Next.js (Vercel)
 *                           |                                   ^
 *                           +------ WebSocket (live push) ------+--> browser
 *
 * This listens on PLAIN HTTP. That's deliberate: Render (and the dev tunnel)
 * terminate real TLS with a valid certificate and forward plain HTTP to this
 * process's port. The tracker only ever talks https:// to that edge, and the
 * browser talks wss:// to it.
 *
 * ROUTES
 *   POST /api/tracker-data     <- the tracker posts each telemetry record
 *                                  here, authenticated with an
 *                                  "Authorization: Bearer <AUTH_TOKEN>"
 *                                  header. Body:
 *     {"device_id":"TRK-0001","latitude":33.6,"longitude":73.0,
 *      "speed":42.3,"crash":false,"recorded_at":"2026-09-19T13:00:03.412Z",
 *      "created_at":"2026-09-19T13:00:03.000Z"}
 *     device_id must be a tracker registered on the dashboard's Devices page
 *     and the token must match the hash stored for it; both are checked
 *     before anything is written. Timestamps are UTC ("Z"; the "+05:00" of
 *     3.3/3.4 firmware is also accepted). A batch of buffered records can be
 *     sent as a JSON array or {"device_id":..,"records":[..]}; it is
 *     processed oldest first.
 *     The record is stored as a GPS point; the newest one becomes the
 *     tracker's live position (older backlog records don't replace it);
 *     crash:true creates a crash alert; crossing a geofence edge creates a
 *     geofence alert. Each of these is pushed to open dashboards at once.
 *     Replies: 201 stored - 200 stored:false (duplicate, or no usable
 *     position/time: answered 2xx so the tracker's buffer isn't blocked by a
 *     record that can never be stored) - 400 bad JSON / no device_id -
 *     401 unknown device or wrong token - 403 tracker suspended.
 *
 *   GET  /api/firmware/latest  <- the tracker's otaFetchManifest() call.
 *                                  Authenticated. Returns
 *     {"version":"3.6.3","url":"https://.../firmware/firmware-3.6.3.bin",
 *      "size":441273,"sha256":"<64 hex chars>"}
 *     for the highest version uploaded on the dashboard's Firmware page, or
 *     404 until something has been uploaded.
 *   GET  /firmware/<file>.bin  <- the tracker's otaInstall() download.
 *                                  Authenticated. Honours "?range=a-b" or
 *                                  "Range: bytes=a-b" with 206 Partial
 *                                  Content - the tracker fetches the image
 *                                  16 KB at a time this way.
 *
 *   WS   /ws?token=<ticket>    -> live updates for a logged-in dashboard
 *                                  user. The ticket is a short-lived JWT the
 *                                  Next.js app issues (GET /api/realtime).
 *                                  Messages:
 *     {"type":"position","trackerId":..,"lat":..,"lng":..,"speed":..,
 *      "timestamp":..,"lastSeen":..}
 *     {"type":"alert","trackerId":..,"alertType":"crash"|"geofence",
 *      "message":..}
 *     A user only receives events for trackers they may see; alerts go only
 *     to the owner and the admin, not to invited viewers.
 *
 *   GET  / and /healthz        -> "ok" (Render's health check).
 *
 * Run:
 *   npm install        (once: pg, ws, bcryptjs, jsonwebtoken)
 *   node tracker-api.js
 *
 * ENVIRONMENT (a local .env file, or the Environment tab on Render - real
 * environment variables always win over .env):
 *   DATABASE_URL     the Neon connection string (same as the Next.js app)
 *   JWT_SECRET       same value as the Next.js app (checks WebSocket tickets)
 *   FRONTEND_ORIGIN  optional, e.g. https://k-track.vercel.app - if set, only
 *                    pages from this origin may open the WebSocket
 *                    (several origins: comma-separated)
 *   ADMIN_EMAIL      optional, default admin@fleettrack.com
 *   PORT             set by Render; 33430 locally
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool, types } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { WebSocketServer } = require("ws");

// Minimal .env loader (no dotenv dependency) - KEY=VALUE per line, "#" comments,
// blank lines ignored. Doesn't override a variable already set in the real
// environment.
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return; // no .env file - fine, rely on real environment variables
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, ".env"));

// Render sets PORT itself (it picks the value, commonly 10000) and expects
// the process to listen on it; falls back to 33430 for local/tunnel runs.
const PORT = process.env.PORT || 33430;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@fleettrack.com";
const ALLOWED_ORIGINS = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const MAX_BODY_BYTES = 256 * 1024;        // reject oversized telemetry posts
const MAX_BATCH_RECORDS = 500;
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000; // a record dated further ahead is discarded

if (!process.env.DATABASE_URL || !JWT_SECRET) {
  console.error("DATABASE_URL and JWT_SECRET must be set (in .env or the environment).");
  process.exit(1);
}

// recorded_at and the other time columns are "timestamp without time zone"
// holding UTC. Read them as UTC (node-postgres would assume local time).
types.setTypeParser(1114, (value) => new Date(value.replace(" ", "T") + "Z"));

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
db.on("error", (err) => console.error("Database connection error:", err.message));

// ----------------------------------------------------------------- HTTP helpers

// Older firmware (3.3.x) packed two headers into the modem's single USERDATA
// parameter, joined with "\r\n" typed as text. The A7608E-H sends that
// literally - backslash, r, backslash, n - so it arrives as ONE header:
//   Authorization: Bearer <token>\r\nRange: bytes=0-24575
// Split such a header back into the real ones so those trackers can still
// authenticate and download their update.
function splitMergedHeaders(req) {
  const raw = req.headers["authorization"];
  if (!raw || !raw.includes("\\r\\n")) return;
  const [auth, ...extra] = raw.split("\\r\\n");
  req.headers["authorization"] = auth.trim();
  for (const line of extra) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (req.headers[name] === undefined) req.headers[name] = line.slice(colon + 1).trim();
  }
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers["authorization"] || "");
  return match ? match[1].trim() : "";
}

// Always sends an explicit Content-Length. Without it Node falls back to
// "Transfer-Encoding: chunked", and the SIMCom modem's HTTP client then
// reports a body length of 0 in +HTTPACTION - so the tracker could never
// read the OTA manifest.
function sendBody(res, status, contentType, text) {
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, { "Content-Type": contentType, "Content-Length": body.length });
  res.end(body);
}

function sendJson(res, status, obj) {
  sendBody(res, status, "application/json", JSON.stringify(obj));
}

function readBody(req, onReady) {
  const chunks = [];
  let total = 0;
  let tooLarge = false;
  req.on("data", (chunk) => {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      tooLarge = true;
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!tooLarge) onReady(Buffer.concat(chunks).toString("utf8"));
  });
}

// ----------------------------------------------------------------- device auth

// Device tokens are stored as bcrypt hashes. bcrypt is slow on purpose and a
// tracker sends a record every 5 seconds, so a token that has already passed
// the bcrypt check is remembered in memory (as a digest, per stored hash)
// while this process lives. Nothing here is written to disk.
const verifiedTokens = new Set();

async function verifyDeviceToken(token, storedHash) {
  const key = crypto.createHash("sha256").update(storedHash + "\n" + token).digest("hex");
  if (verifiedTokens.has(key)) return true;

  const valid = await bcrypt.compare(token, storedHash);
  if (valid) {
    if (verifiedTokens.size >= 5000) verifiedTokens.clear();
    verifiedTokens.add(key);
  }
  return valid;
}

// The OTA requests carry the token but no device id, so the token is checked
// against each active tracker's hash.
async function isRegisteredDevice(req) {
  const token = bearerToken(req);
  if (!token) return false;

  const { rows } = await db.query("SELECT secret_token_hash FROM trackers WHERE status = 'ACTIVE'");
  for (const row of rows) {
    if (await verifyDeviceToken(token, row.secret_token_hash)) return true;
  }
  return false;
}

// ----------------------------------------------------------------- live push

const wss = new WebSocketServer({ noServer: true });
const VISIBILITY_REFRESH_MS = 60 * 1000;

// Which trackers this user may see: "owned" (own trackers - positions and
// alerts) and "shared" (invited viewer - positions only). The admin sees all.
async function loadVisibility(socket) {
  if (socket.isAdmin) return;
  const [owned, shared] = await Promise.all([
    db.query("SELECT tracker_id FROM trackers WHERE user_id = $1", [socket.userId]),
    db.query("SELECT tracker_id FROM tracker_shares WHERE viewer_user_id = $1", [socket.userId]),
  ]);
  socket.owned = new Set(owned.rows.map((row) => row.tracker_id));
  socket.shared = new Set(shared.rows.map((row) => row.tracker_id));
}

function broadcast(event) {
  const message = JSON.stringify(event);
  for (const socket of wss.clients) {
    if (socket.readyState !== socket.OPEN) continue;
    const owns = socket.isAdmin || socket.owned.has(event.trackerId);
    const sees = owns || (event.type === "position" && socket.shared.has(event.trackerId));
    if (sees) socket.send(message);
  }
}

// A ping every 25 s keeps tunnels/proxies from closing an idle socket and
// drops browsers that went away; visibility is re-read every minute so a
// newly registered or newly shared tracker starts arriving.
setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
    if (Date.now() - socket.visibilityAt > VISIBILITY_REFRESH_MS) {
      socket.visibilityAt = Date.now();
      loadVisibility(socket).catch((err) => console.error("Visibility refresh failed:", err.message));
    }
  }
}, 25000);

function handleUpgrade(req, socket, head) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const reject = (status) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  if (url.pathname !== "/ws") return reject("404 Not Found");

  const origin = (req.headers.origin || "").replace(/\/$/, "");
  if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    return reject("403 Forbidden");
  }

  let ticket;
  try {
    ticket = jwt.verify(url.searchParams.get("token") || "", JWT_SECRET);
  } catch (e) {
    return reject("401 Unauthorized");
  }
  // Only tickets made for this purpose - a login cookie's JWT is not accepted.
  if (ticket.purpose !== "realtime" || !Number.isInteger(ticket.userId)) {
    return reject("401 Unauthorized");
  }

  wss.handleUpgrade(req, socket, head, async (ws) => {
    ws.userId = ticket.userId;
    ws.isAdmin = ticket.email === ADMIN_EMAIL;
    ws.owned = new Set();
    ws.shared = new Set();
    ws.isAlive = true;
    ws.visibilityAt = Date.now();
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("error", () => {});
    try {
      await loadVisibility(ws);
      ws.send(JSON.stringify({ type: "ready" }));
    } catch (err) {
      console.error("WebSocket setup failed:", err.message);
      ws.close(1011);
    }
  });
}

// ----------------------------------------------------------------- telemetry

function recordDeviceId(record) {
  const id = record && (record.device_id !== undefined ? record.device_id : record.deviceId);
  return typeof id === "string" ? id.trim() : "";
}

function recordTime(record) {
  return new Date(record && (record.recorded_at !== undefined ? record.recorded_at : record.timestamp));
}

// Stores one record. `tracker` carries the tracker's last known position and
// is moved forward as records are stored, so a batch behaves like the same
// records arriving one by one. Returns "stored", "duplicate" or "discarded".
async function storeRecord(tracker, record) {
  const id = tracker.tracker_id;
  const recordedAt = recordTime(record);

  if (isNaN(recordedAt.getTime())) return "discarded";
  if (recordedAt.getTime() > Date.now() + MAX_FUTURE_MS) return "discarded";

  const at = recordedAt.toISOString();
  const crash = record.crash === true;
  const { latitude, longitude } = record;
  // Coordinates are stored only for a real fix. Firmware before 3.6.0 could
  // send null (or stale) coordinates for a crash without a GPS fix.
  const hasPosition =
    typeof latitude === "number" && typeof longitude === "number" &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0);
  const speed = typeof record.speed === "number" && record.speed >= 0 ? record.speed : 0;

  if (!hasPosition) {
    if (crash) {
      const alert = await db.query(
        `INSERT INTO alerts (tracker_id, type, message, recorded_at)
         VALUES ($1, 'crash', 'Crash detected (no GPS fix)', $2::timestamptz AT TIME ZONE 'UTC')
         ON CONFLICT DO NOTHING RETURNING message`,
        [id, at]
      );
      if (alert.rowCount > 0) {
        broadcast({ type: "alert", trackerId: id, alertType: "crash", message: alert.rows[0].message, timestamp: at });
      }
    }
    return "discarded";
  }

  // The tracker re-sends a buffered record when a reply was lost; the same
  // (tracker, time) is stored once.
  const point = await db.query(
    `INSERT INTO location_points (tracker_id, longitude, latitude, speed, crash, recorded_at, location)
     VALUES ($1, $2::float8, $3::float8, $4::float8, $5, $6::timestamptz AT TIME ZONE 'UTC',
             ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326))
     ON CONFLICT (tracker_id, recorded_at) DO NOTHING`,
    [id, longitude, latitude, speed, crash, at]
  );
  if (point.rowCount === 0) return "duplicate";

  if (crash) {
    const alert = await db.query(
      `INSERT INTO alerts (tracker_id, type, message, longitude, latitude, speed, recorded_at, location)
       VALUES ($1, 'crash', 'Crash detected by tracker', $2::float8, $3::float8, $4::float8,
               $5::timestamptz AT TIME ZONE 'UTC', ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326))
       ON CONFLICT DO NOTHING RETURNING message`,
      [id, longitude, latitude, speed, at]
    );
    if (alert.rowCount > 0) {
      broadcast({ type: "alert", trackerId: id, alertType: "crash", message: alert.rows[0].message, timestamp: at });
    }
  }

  // Keep the newest record as the live position: backlog records drained
  // after an outage are older and must not replace it.
  const isNewest = !tracker.last_recorded_at || recordedAt > tracker.last_recorded_at;
  if (!isNewest) return "stored";

  await db.query(
    `UPDATE trackers
     SET last_longitude = $2::float8, last_latitude = $3::float8, last_speed = $4::float8,
         last_recorded_at = $5::timestamptz AT TIME ZONE 'UTC'
     WHERE tracker_id = $1`,
    [id, longitude, latitude, speed, at]
  );

  broadcast({
    type: "position",
    trackerId: id,
    lat: latitude,
    lng: longitude,
    speed,
    timestamp: at,
    lastSeen: new Date().toISOString(),
  });

  if (tracker.last_longitude !== null && tracker.last_latitude !== null) {
    // Geofence alert when this point is on the other side of a zone's edge
    // from the previous one.
    const alerts = await db.query(
      `INSERT INTO alerts (tracker_id, type, message, longitude, latitude, speed, recorded_at, geofence_id, location)
       SELECT $1, 'geofence', CASE WHEN z.now_in THEN 'Entered ' ELSE 'Left ' END || z.name,
              $2::float8, $3::float8, $4::float8, $5::timestamptz AT TIME ZONE 'UTC', z.geofence_id,
              ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)
       FROM (
         SELECT g.geofence_id, g.name, g.alert_on_enter, g.alert_on_exit,
                ST_Covers(g.area, ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)) AS now_in,
                ST_Covers(g.area, ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326)) AS was_in
         FROM geofences g
         WHERE g.tracker_id = $1
       ) z
       WHERE (z.now_in AND NOT z.was_in AND z.alert_on_enter)
          OR (z.was_in AND NOT z.now_in AND z.alert_on_exit)
       ON CONFLICT DO NOTHING RETURNING message`,
      [id, longitude, latitude, speed, at, tracker.last_longitude, tracker.last_latitude]
    );
    for (const alert of alerts.rows) {
      broadcast({ type: "alert", trackerId: id, alertType: "geofence", message: alert.message, timestamp: at });
    }
  }

  tracker.last_longitude = longitude;
  tracker.last_latitude = latitude;
  tracker.last_recorded_at = recordedAt;
  return "stored";
}

// Prints one line per received record (on Render: the service's Logs tab).
function logRecord(deviceId, record, result) {
  const { token, ...shown } = record;
  console.log(`[DATA] ${deviceId} ${result}: ${JSON.stringify(shown)}`);
}

async function handleTelemetry(req, res, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: "invalid JSON" });
  }

  const isBatch = Array.isArray(data) || Array.isArray(data && data.records);
  const records = Array.isArray(data) ? data : isBatch ? data.records : [data];

  if (records.length === 0 || records.some((r) => typeof r !== "object" || r === null)) {
    return sendJson(res, 400, { ok: false, error: "malformed payload" });
  }
  if (records.length > MAX_BATCH_RECORDS) {
    return sendJson(res, 413, { ok: false, error: `at most ${MAX_BATCH_RECORDS} records per request` });
  }

  const envelope = Array.isArray(data) ? records[0] : data;
  const deviceId = recordDeviceId(envelope) || recordDeviceId(records[0]);
  // The firmware sends the token in the Authorization header; a "token"
  // field in the body is accepted as well.
  const token = bearerToken(req) || (typeof envelope.token === "string" ? envelope.token.trim() : "");

  if (!deviceId) return sendJson(res, 400, { ok: false, error: "missing device_id" });
  if (!token) return sendJson(res, 401, { ok: false, error: "invalid or missing Authorization header" });
  if (records.some((r) => recordDeviceId(r) && recordDeviceId(r) !== deviceId)) {
    return sendJson(res, 400, { ok: false, error: "all records must be from the same device" });
  }

  const found = await db.query(
    `SELECT tracker_id, secret_token_hash, status, last_longitude, last_latitude, last_recorded_at
     FROM trackers WHERE tracker_id = $1`,
    [deviceId]
  );
  const tracker = found.rows[0];

  // Same reply for an unknown device and a wrong token.
  if (!tracker || !(await verifyDeviceToken(token, tracker.secret_token_hash))) {
    console.log(`[DATA] ${deviceId} rejected: unknown device or invalid token`);
    return sendJson(res, 401, { ok: false, error: "unknown device or invalid token" });
  }
  if (tracker.status !== "ACTIVE") {
    return sendJson(res, 403, { ok: false, error: "tracker is suspended" });
  }

  await db.query(
    "UPDATE trackers SET last_received_at = NOW() AT TIME ZONE 'UTC' WHERE tracker_id = $1",
    [deviceId]
  );

  if (!isBatch) {
    const result = await storeRecord(tracker, records[0]);
    logRecord(deviceId, records[0], result);
    return result === "stored"
      ? sendJson(res, 201, { ok: true, stored: true })
      : sendJson(res, 200, { ok: true, stored: false, reason: result });
  }

  // Oldest first; records without a readable time go last and are discarded.
  const sortKey = (record) => {
    const ms = recordTime(record).getTime();
    return isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
  };
  const counts = { stored: 0, duplicate: 0, discarded: 0 };
  for (const record of [...records].sort((a, b) => sortKey(a) - sortKey(b))) {
    const result = await storeRecord(tracker, record);
    logRecord(deviceId, record, result);
    counts[result]++;
  }
  sendJson(res, 201, { ok: true, received: records.length, ...counts });
}

// ----------------------------------------------------------------- OTA

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// The release trackers are offered: the highest version uploaded on the
// dashboard's Firmware page.
async function latestFirmware() {
  const { rows } = await db.query("SELECT version, filename, size, sha256 FROM firmware_releases");
  rows.sort((a, b) => compareVersions(b.version, a.version));
  return rows[0] || null;
}

async function handleManifest(req, res) {
  if (!(await isRegisteredDevice(req))) {
    return sendJson(res, 401, { ok: false, error: "invalid or missing Authorization header" });
  }
  const latest = await latestFirmware();
  if (!latest) return sendJson(res, 404, { ok: false, error: "no firmware uploaded yet" });

  // Dev tunnels may rewrite Host to localhost:<port>; the public hostname the
  // tracker actually used is in X-Forwarded-Host.
  const publicHost = req.headers["x-forwarded-host"] || req.headers.host;
  sendJson(res, 200, {
    version: latest.version,
    url: `https://${publicHost}/firmware/${latest.filename}`,
    size: latest.size,
    sha256: latest.sha256,
  });
}

async function handleFirmwareDownload(req, res, url) {
  if (!(await isRegisteredDevice(req))) {
    return sendJson(res, 401, { ok: false, error: "invalid or missing Authorization header" });
  }
  const filename = path.basename(url.pathname);
  const found = await db.query("SELECT size FROM firmware_releases WHERE filename = $1", [filename]);
  if (found.rowCount === 0) return sendJson(res, 404, { ok: false, error: "not found" });
  const total = found.rows[0].size;

  // The tracker downloads the image in 16 KB pieces so its modem never has to
  // hold the whole file. Byte range from the Range header, or from
  // "?range=a-b" in the URL - current firmware uses the query form so it
  // never needs a second header.
  const queryRange = url.searchParams.get("range");
  const range = req.headers["range"] || (queryRange ? `bytes=${queryRange}` : undefined);

  let start = 0;
  let end = total - 1;
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
    start = m ? Number(m[1]) : NaN;
    end = m && m[2] !== "" ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (!m || start >= total || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${total}`, "Content-Length": 0 });
      return res.end();
    }
  }

  const length = end - start + 1;
  const piece = await db.query(
    "SELECT substring(data FROM $2::int FOR $3::int) AS chunk FROM firmware_releases WHERE filename = $1",
    [filename, start + 1, length]
  );
  const chunk = piece.rows[0].chunk;

  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Length": chunk.length,
    "Accept-Ranges": "bytes",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
  res.writeHead(range ? 206 : 200, headers);
  res.end(chunk);
}

// ----------------------------------------------------------------- server

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  splitMergedHeaders(req);

  const fail = (err) => {
    console.error(`${req.method} ${url.pathname} failed:`, err.message);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: "server error" });
  };

  if (req.method === "POST" && url.pathname === "/api/tracker-data") {
    return readBody(req, (text) => handleTelemetry(req, res, text).catch(fail));
  }

  if (req.method === "GET" && url.pathname === "/api/firmware/latest") {
    return handleManifest(req, res).catch(fail);
  }

  if (req.method === "GET" && url.pathname.startsWith("/firmware/")) {
    return handleFirmwareDownload(req, res, url).catch(fail);
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
    return sendJson(res, 200, { ok: true, service: "k-track-backend" });
  }

  sendJson(res, 404, { ok: false, error: "not found" });
});

server.on("upgrade", handleUpgrade);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on port ${PORT} (plain HTTP - a tunnel or Render terminates TLS in front of this)`);
  console.log(`POST http://localhost:${PORT}/api/tracker-data  <- reachable locally, or via your tunnel/Render URL`);
  console.log(`WS   ws://localhost:${PORT}/ws                  -> live updates for the dashboard`);
});
