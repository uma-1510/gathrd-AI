import { NextResponse } from "next/server";

export default function proxy(req) {
  const { pathname } = req.nextUrl;

  const publicPaths = [
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/api/auth',
    '/api/test-email',
  ];

  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));
  const isStatic =
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico';

  if (isStatic || isPublicPath) {
    return NextResponse.next();
  }

  const token =
    req.cookies.get('authjs.session-token') ??
    req.cookies.get('__Secure-authjs.session-token');

  const isLoggedIn = !!token;

  if (!isLoggedIn) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (isLoggedIn && (pathname.startsWith('/login') || pathname.startsWith('/signup'))) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};