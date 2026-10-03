// Sends records to the backend (backend/tracker-api.js) exactly as the tracker firmware does
// (same URL path, header and JSON fields), so the whole pipeline can be
// tested without the hardware.
//
//   node scripts/simulate-tracker.mjs --url http://localhost:33430 --device TRK-0001 --token <AUTH_TOKEN>
//
// Options:
//   --count N       records to send (default 20)
//   --interval MS   delay between records (default 5000, like the firmware)
//   --crash N       send crash:true on record number N
//   --lat/--lng     start position (default Islamabad 33.6844, 73.0479)
//   --start ISO     timestamp of the first record (default: now). With a past
//                   time and --interval 0 this replays an offline backlog.
//   --step MS       time between record timestamps (default: --interval, or 5000)

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, [])
);

const baseUrl = (args.url || 'http://localhost:33430').replace(/\/$/, '');
const device = args.device;
const token = args.token;
if (!device || !token) {
  console.error('Usage: node scripts/simulate-tracker.mjs --url <base url> --device <tracker id> --token <device token>');
  process.exit(1);
}

const count = Number(args.count ?? 20);
const interval = Number(args.interval ?? 5000);
const step = Number(args.step ?? (interval || 5000));
const crashAt = args.crash ? Number(args.crash) : -1;
let lat = Number(args.lat ?? 33.6844);
let lng = Number(args.lng ?? 73.0479);
let time = args.start ? Date.parse(args.start) : Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let i = 1; i <= count; i++) {
  const speed = 30 + Math.round(Math.random() * 300) / 10;
  // Drive north-east at roughly that speed.
  const metres = (speed / 3.6) * (step / 1000);
  lat += (metres * 0.7) / 111320;
  lng += (metres * 0.7) / (111320 * Math.cos((lat * Math.PI) / 180));

  const record = {
    device_id: device,
    latitude: Number(lat.toFixed(7)),
    longitude: Number(lng.toFixed(7)),
    speed,
    crash: i === crashAt,
    recorded_at: new Date(time).toISOString(),
    created_at: new Date(Math.floor(time / 1000) * 1000).toISOString(),
  };

  try {
    const res = await fetch(`${baseUrl}/api/tracker-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(record),
    });
    console.log(
      `#${i} ${record.recorded_at} ${record.latitude},${record.longitude} ${speed} km/h` +
        `${record.crash ? ' CRASH' : ''} -> HTTP ${res.status} ${await res.text()}`
    );
  } catch (error) {
    console.log(`#${i} send failed: ${error.message}`);
  }

  time += step;
  if (i < count && interval > 0) await sleep(interval);
}
