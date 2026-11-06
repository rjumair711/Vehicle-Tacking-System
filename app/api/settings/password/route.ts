import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getSession, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json(
    { message: 'Current password and an 8–128 character new password are required' }, { status: 400 }
  );

  try {
    const user = await prisma.user.findUnique({ where: { userId: session.userId } });
    if (!user) return NextResponse.json({ message: 'User not found' }, { status: 404 });

    if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      return NextResponse.json({ message: 'Current password is incorrect' }, { status: 400 });
    }
    if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) {
      return NextResponse.json({ message: 'Choose a different password' }, { status: 400 });
    }
    await prisma.user.update({
      where: { userId: session.userId },
      data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) },
    });
    await prisma.$executeRaw`DELETE FROM password_reset_tokens WHERE user_id = ${session.userId}`;
    return NextResponse.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('PUT /api/settings/password error:', error);
    return NextResponse.json({ message: 'Failed to update password' }, { status: 500 });
  }
}
