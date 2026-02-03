import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional shared-secret auth for all API routes.
 * Set AUTH_SECRET env var to enable. When unset, all routes are open (local dev).
 * Clients must send: Authorization: Bearer <secret>
 */
export function middleware(request: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return NextResponse.next();

  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
