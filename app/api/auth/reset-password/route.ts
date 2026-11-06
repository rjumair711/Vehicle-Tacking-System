import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
const schema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: 'Invalid reset link or password (8–128 characters required)' }, { status: 400 });

  const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex');
  try {
    // Take token in a short transaction. The delete prevents concurrent reuse.
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const changed = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ user_id: number }>>`
        DELETE FROM password_reset_tokens
        WHERE token_hash = ${tokenHash} AND expires_at > NOW()
        RETURNING user_id
      `;
      if (rows.length !== 1) return false;
      await tx.user.update({ where: { userId: Number(rows[0].user_id) }, data: { passwordHash } });
      return true;
    });
    if (!changed) return NextResponse.json({ message: 'This reset link is invalid or has expired. Request a new one.' }, { status: 400 });
    return NextResponse.json({ message: 'Password changed successfully. You can sign in now.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ message: 'Password reset failed. Try requesting another link.' }, { status: 500 });
  }
}
