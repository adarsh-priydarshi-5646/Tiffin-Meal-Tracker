import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_only_for_dev');

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('tiffin_token')?.value;

  const isAuthPage = request.nextUrl.pathname === '/login';
  const isApiAuthRoute = request.nextUrl.pathname.startsWith('/api/auth/');

  if (isAuthPage || isApiAuthRoute) {
    // If the user is already logged in and tries to access /login, redirect to home
    if (isAuthPage && token) {
      try {
        await jwtVerify(token, JWT_SECRET);
        return NextResponse.redirect(new URL('/', request.url));
      } catch (e) {
        // Token is invalid, let them proceed to login
      }
    }
    return NextResponse.next();
  }

  // Check valid token for all other routes
  try {
    if (!token) throw new Error('No token');
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch (error) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - sw.js, manifest.json, icon.svg (PWA files)
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icon.svg).*)',
  ],
};
