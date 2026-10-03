import { prisma } from '@/lib/prisma';

// Firmware images are uploaded here (dashboard, Firmware page) and stored in
// the database. The backend on Render (backend/tracker-api.js) serves them to
// the trackers.

// One ESP32 OTA slot is 1,310,720 bytes ("Default 4MB with spiffs"); an
// oversized upload is refused here rather than failing on the device.
export const MAX_FIRMWARE_BYTES = 1200 * 1024;

// The firmware's otaIsNewer() only understands "major.minor.patch".
export const FIRMWARE_VERSION_PATTERN = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// Metadata only - the image bytes stay in the database. Highest version first.
export async function listFirmwareReleases() {
  const releases = await prisma.firmwareRelease.findMany({
    select: { version: true, filename: true, size: true, sha256: true, uploadedAt: true },
  });
  return releases.sort((a, b) => compareVersions(b.version, a.version));
}
