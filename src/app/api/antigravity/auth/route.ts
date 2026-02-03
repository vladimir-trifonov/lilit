/**
 * Antigravity OAuth initiation — redirects to Google consent screen.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { OAUTH_STATE_COOKIE } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = process.env.ANTIGRAVITY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "ANTIGRAVITY_CLIENT_ID not configured" },
      { status: 500 },
    );
  }

  const origin = new URL(req.url).origin;
  const state = randomBytes(32).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/antigravity/callback`,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/generative-language",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );

  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
