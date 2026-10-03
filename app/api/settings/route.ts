import { NextResponse } from 'next/server';
import { getSession, unauthorized } from '@/lib/auth';
import {
  SPEED_UNITS,
  THEMES,
  getUserSettings,
  saveUserSettings,
} from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    return NextResponse.json(await getUserSettings(session.userId));
  } catch (error) {
    console.error('GET /api/settings error:', error);
    return NextResponse.json({ message: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const body = await req.json();
    const current = await getUserSettings(session.userId);

    const settings = {
      crashAlerts: typeof body.crashAlerts === 'boolean' ? body.crashAlerts : current.crashAlerts,
      geofenceAlerts:
        typeof body.geofenceAlerts === 'boolean' ? body.geofenceAlerts : current.geofenceAlerts,
      theme: THEMES.includes(body.theme) ? body.theme : current.theme,
      speedUnit: SPEED_UNITS.includes(body.speedUnit) ? body.speedUnit : current.speedUnit,
    };

    await saveUserSettings(session.userId, settings);

    return NextResponse.json({ message: 'Settings saved successfully', settings });
  } catch (error) {
    console.error('PUT /api/settings error:', error);
    return NextResponse.json({ message: 'Failed to save settings' }, { status: 500 });
  }
}
