import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('token')?.value;

        if (!token) {
            return NextResponse.json({ user: null }, { status: 401 });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
            userId: string;
        };

        const user = await prisma.user.findUnique({
            where: { userId: Number(decoded.userId) },
            select: {
                userId: true,
                username: true,
                email: true,
            },
        });

        if (!user) {
            return NextResponse.json({ user: null }, { status: 401 });
        }

        return NextResponse.json({
            user: {
                id: String(user.userId),
                email: user.email,
                name: user.username,
                role: user.email === "admin@fleettrack.com" ? "ADMIN" : "USER",
            },
        });
    } catch (error) {
        console.error('Me route error:', error);
        return NextResponse.json({ user: null }, { status: 401 });
    }
}