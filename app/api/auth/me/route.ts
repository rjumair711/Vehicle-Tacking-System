import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getUserSettings } from '@/lib/settings';
import { getUserRole } from '@/lib/trackers';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const session = await getSession();

        if (!session) {
            return NextResponse.json({ user: null }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { userId: session.userId },
            select: {
                userId: true,
                username: true,
                email: true,
                company: true,
            },
        });

        if (!user) {
            return NextResponse.json({ user: null }, { status: 401 });
        }

        const settings = await getUserSettings(user.userId);

        return NextResponse.json({
            user: {
                id: String(user.userId),
                email: user.email,
                name: user.username,
                company: user.company,
                role: await getUserRole(session),
                speedUnit: settings.speedUnit,
            },
        });
    } catch (error) {
        console.error('Me route error:', error);
        return NextResponse.json({ user: null }, { status: 401 });
    }
}
