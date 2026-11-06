import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
const schema = z.object({ email: z.string().trim().toLowerCase().email().max(150) });
const accepted = { message: 'If an account exists for that email, a reset link will be sent.' };

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: 'Enter a valid email address' }, { status: 400 });

  // Refuse to pretend the recovery flow is configured if email cannot be sent.
  const { RESEND_API_KEY, RESET_EMAIL_FROM, APP_URL } = process.env;
  if (!RESEND_API_KEY || !RESET_EMAIL_FROM || !APP_URL || !APP_URL.startsWith('https://')) {
    console.error('Password reset email is not configured (RESEND_API_KEY, RESET_EMAIL_FROM, HTTPS APP_URL).');
    return NextResponse.json({ message: 'Password recovery is temporarily unavailable. Contact your administrator.' }, { status: 503 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { userId: true, email: true } });
    if (!user) return NextResponse.json(accepted);

    // A database-backed cooldown to prevent rapid repeat emails to a customer.
    const recent = await prisma.$queryRaw<Array<{ requested_at: Date }>>`
      SELECT requested_at FROM password_reset_tokens WHERE user_id = ${user.userId} LIMIT 1
    `;
    if (recent.length && Date.now() - new Date(recent[0].requested_at).getTime() < 60_000) {
      return NextResponse.json(accepted);
    }

    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    await prisma.$executeRaw`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_at)
      VALUES (${user.userId}, ${hash}, NOW() + INTERVAL '15 minutes', NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        expires_at = EXCLUDED.expires_at,
        requested_at = EXCLUDED.requested_at
    `;
    const url = new URL('/reset-password', APP_URL);
    url.searchParams.set('token', token);

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESET_EMAIL_FROM,
        to: [user.email],
        subject: 'Reset your FleetTrack password',
        text: `A password reset was requested for your FleetTrack account.\n\nOpen this link to choose a new password (valid for 15 minutes):\n${url.toString()}\n\nIf you did not request this, ignore this message.`,
      }),
      cache: 'no-store',
    });
    if (!emailResponse.ok) {
      console.error('Reset email provider error:', emailResponse.status);
      await prisma.$executeRaw`DELETE FROM password_reset_tokens WHERE user_id = ${user.userId} AND token_hash = ${hash}`;
      return NextResponse.json(accepted);
    }
    return NextResponse.json(accepted);
  } catch (error) {
    console.error('Password recovery request error:', error);
    return NextResponse.json({ message: 'Password recovery is temporarily unavailable' }, { status: 503 });
  }
}
