import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ADMIN_EMAIL, forbidden, getSession, unauthorized } from '@/lib/auth';
import { hashPassword } from '@/lib/passwords';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ password: z.string().min(8).max(128) });

// Admin sets a customer-chosen password. No generated password is returned.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId === session.userId) {
    return NextResponse.json({ message: 'Invalid customer ID' }, { status: 400 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: 'Password must be between 8 and 128 characters' }, { status: 400 });
  }
  try {
    const user = await prisma.user.findUnique({ where: { userId }, select: { userId: true, email: true } });
    if (!user) return NextResponse.json({ message: 'Customer not found' }, { status: 404 });
    if (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return forbidden();
    await prisma.user.update({
      where: { userId },
      data: { passwordHash: await hashPassword(parsed.data.password) },
    });
    // Invalidate any outstanding self-service reset links for this account.
    await prisma.$executeRaw`DELETE FROM password_reset_tokens WHERE user_id = ${userId}`;
    return NextResponse.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Admin password change error:', error);
    return NextResponse.json({ message: 'Failed to update password' }, { status: 500 });
  }
}
