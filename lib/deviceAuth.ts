import bcrypt from 'bcryptjs';

// Device tokens (the firmware's AUTH_TOKEN) are stored as bcrypt hashes.
// They are checked by the backend on Render (backend/tracker-api.js); this
// app only creates the hash when the admin registers a device.
export const MIN_DEVICE_TOKEN_LENGTH = 32;

export function hashDeviceToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10);
}
