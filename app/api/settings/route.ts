import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';

function getUserFromRequest(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      email: string;
      role: string;
      name: string;
    };
    return decoded;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const authUser = getUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    let settings = await prisma.userSettings.findUnique({
      where: { userId: authUser.userId },
    });

    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          userId: authUser.userId,
        },
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error('GET /api/settings error:', error);
    return NextResponse.json({ message: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = getUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    const updated = await prisma.userSettings.upsert({
      where: { userId: authUser.userId },
      update: {
        emailAlerts: body.emailAlerts,
        speedingAlerts: body.speedingAlerts,
        geofenceAlerts: body.geofenceAlerts,
        maintenanceAlerts: body.maintenanceAlerts,
        offlineAlerts: body.offlineAlerts,
        theme: body.theme,
        speedUnit: body.speedUnit,
        temperatureUnit: body.temperatureUnit,
      },
      create: {
        userId: authUser.userId,
        emailAlerts: body.emailAlerts,
        speedingAlerts: body.speedingAlerts,
        geofenceAlerts: body.geofenceAlerts,
        maintenanceAlerts: body.maintenanceAlerts,
        offlineAlerts: body.offlineAlerts,
        theme: body.theme,
        speedUnit: body.speedUnit,
        temperatureUnit: body.temperatureUnit,
      },
    });

    return NextResponse.json({
      message: 'Settings saved successfully',
      settings: updated,
    });
  } catch (error) {
    console.error('PUT /api/settings error:', error);
    return NextResponse.json({ message: 'Failed to save settings' }, { status: 500 });
  }
}