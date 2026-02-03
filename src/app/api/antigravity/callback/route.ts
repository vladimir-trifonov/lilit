/**
 * Antigravity OAuth callback — exchanges code for tokens and stores in DB.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { OAUTH_STATE_COOKIE } from "@/lib/constants";

export const dynamic = "force-dynamic";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  id_token?: string;
}

interface UserInfo {
  email: string;
}

export async function GET(req: NextRequest) {
  const reqUrl = new URL(req.url);
  const origin = reqUrl.origin;
  const { searchParams } = reqUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  if (error) {
    return NextResponse.redirect(`${origin}/?antigravity=error`);
  }

  // Verify CSRF state
  const storedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !storedState || state !== storedState) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 403 });
  }

  if (!code) {
    return NextResponse.json({ error: "Missing code parameter" }, { status: 400 });
  }

  const clientId = process.env.ANTIGRAVITY_CLIENT_ID;
  const clientSecret = process.env.ANTIGRAVITY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "OAuth credentials not configured" },
      { status: 500 },
    );
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${origin}/api/antigravity/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return NextResponse.json({ error: "Token exchange failed", details: err }, { status: 502 });
  }

  const tokens = (await tokenRes.json()) as TokenResponse;

  // Get user email from userinfo endpoint
  const userInfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoRes.ok) {
    return NextResponse.json({ error: "Failed to get user info" }, { status: 502 });
  }

  const userInfo = (await userInfoRes.json()) as UserInfo;

  // Upsert account — browser auth takes precedence
  await prisma.oAuthAccount.upsert({
    where: {
      provider_email: { provider: "antigravity", email: userInfo.email },
    },
    create: {
      provider: "antigravity",
      email: userInfo.email,
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      source: "browser",
    },
    update: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      source: "browser",
      disabled: false,
      rateLimitedUntil: null,
    },
  });

  const response = NextResponse.redirect(`${origin}/?antigravity=connected`);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
