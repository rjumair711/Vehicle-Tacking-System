import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;

  // Define routes
  const isAuthRoute = pathname === '/' || pathname.startsWith('/login');
  const isDashboardRoute = pathname.startsWith('/dashboard');

  // 🚫 Not logged in → block dashboard
  if (isDashboardRoute && !token) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // ✅ Logged in → block login page
  if (isAuthRoute && token) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/dashboard/:path*'],
};