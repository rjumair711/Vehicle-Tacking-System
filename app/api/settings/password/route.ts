import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSession, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { message: 'Current password and new password are required' },
        { status: 400 }
      );
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return NextResponse.json(
        { message: 'New password must be at least 6 characters' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { userId: session.userId },
    });

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    const isMatch = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!isMatch) {
      return NextResponse.json(
        { message: 'Current password is incorrect' },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { userId: session.userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });

    return NextResponse.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('PUT /api/settings/password error:', error);
    return NextResponse.json({ message: 'Failed to update password' }, { status: 500 });
  }
}
