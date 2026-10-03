import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Admin is detected by email (no role column in the database).
export const ADMIN_EMAIL = 'admin@fleettrack.com';

export interface Session {
  userId: number;
  email: string;
  isAdmin: boolean;
}

// Reads the login cookie. Returns null when it is missing, expired or invalid.
export async function getSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: number | string;
      email: string;
    };

    const userId = Number(decoded.userId);
    if (!Number.isInteger(userId) || !decoded.email) return null;

    return { userId, email: decoded.email, isAdmin: decoded.email === ADMIN_EMAIL };
  } catch {
    return null;
  }
}

export function unauthorized() {
  return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
}
