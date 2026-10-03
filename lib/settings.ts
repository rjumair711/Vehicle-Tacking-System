import { prisma } from '@/lib/prisma';

export interface UserSettings {
  crashAlerts: boolean;
  geofenceAlerts: boolean;
  theme: string;
  speedUnit: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  crashAlerts: true,
  geofenceAlerts: true,
  theme: 'dark',
  speedUnit: 'km/h',
};

export const THEMES = ['light', 'dark', 'system'];
export const SPEED_UNITS = ['km/h', 'mph', 'm/s'];

export async function getUserSettings(userId: number): Promise<UserSettings> {
  const row = await prisma.userSettings.findUnique({ where: { userId } });
  if (!row) return DEFAULT_SETTINGS;

  return {
    crashAlerts: row.crashAlerts,
    geofenceAlerts: row.geofenceAlerts,
    theme: row.theme,
    speedUnit: row.speedUnit,
  };
}

export async function saveUserSettings(userId: number, settings: UserSettings) {
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...settings },
    update: settings,
  });
}
