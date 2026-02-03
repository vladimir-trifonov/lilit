/**
 * Token manager for Google Antigravity OAuth accounts.
 * Handles round-robin rotation, refresh, rate-limit cooldown,
 * and importing tokens from OpenCode config.
 */

import { prisma } from "@/lib/prisma";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { TOKEN_REFRESH_BUFFER_MS, RATE_LIMIT_COOLDOWN_MS, GOOGLE_OAUTH_TOKEN_URL } from "@/lib/constants";
import { encrypt, decrypt } from "@/lib/crypto";

const PROVIDER = "antigravity";

function getCooldownMs(): number {
  const env = process.env.ANTIGRAVITY_RATE_LIMIT_COOLDOWN_MS;
  return env ? parseInt(env, 10) : RATE_LIMIT_COOLDOWN_MS;
}

interface ActiveToken {
  accessToken: string;
  accountId: string;
  email: string;
}

/**
 * Get the next available OAuth token using round-robin (least-recently-used first).
 * Automatically refreshes tokens expiring within 5 minutes.
 * Returns null if no accounts are available.
 */
export async function getActiveToken(): Promise<ActiveToken | null> {
  const now = new Date();

  const account = await prisma.oAuthAccount.findFirst({
    where: {
      provider: PROVIDER,
      disabled: false,
      OR: [
        { rateLimitedUntil: null },
        { rateLimitedUntil: { lt: now } },
      ],
    },
    orderBy: { lastUsedAt: "asc" },
  });

  if (!account) return null;

  // Refresh if expiring soon
  const expiresIn = account.expiresAt.getTime() - now.getTime();
  if (expiresIn < TOKEN_REFRESH_BUFFER_MS) {
    const refreshed = await refreshAccessToken(account.id);
    if (!refreshed) return null;
  }

  // Re-read after potential refresh
  const fresh = await prisma.oAuthAccount.findUnique({ where: { id: account.id } });
  if (!fresh || fresh.disabled) return null;

  // Mark as used
  await prisma.oAuthAccount.update({
    where: { id: account.id },
    data: { lastUsedAt: now },
  });

  return {
    accessToken: decrypt(fresh.accessToken),
    accountId: fresh.id,
    email: fresh.email,
  };
}

/**
 * Refresh the access token for a given account.
 * Returns true on success, false on failure (disables the account).
 */
export async function refreshAccessToken(accountId: string): Promise<boolean> {
  const account = await prisma.oAuthAccount.findUnique({ where: { id: accountId } });
  if (!account) return false;

  const clientId = process.env.ANTIGRAVITY_CLIENT_ID;
  const clientSecret = process.env.ANTIGRAVITY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // Can't refresh without credentials — disable
    await prisma.oAuthAccount.update({
      where: { id: accountId },
      data: { disabled: true },
    });
    return false;
  }

  try {
    const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: decrypt(account.refreshToken),
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      await prisma.oAuthAccount.update({
        where: { id: accountId },
        data: { disabled: true },
      });
      return false;
    }

    const data = await res.json() as { access_token: string; expires_in: number };

    await prisma.oAuthAccount.update({
      where: { id: accountId },
      data: {
        accessToken: encrypt(data.access_token),
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
    });

    return true;
  } catch {
    await prisma.oAuthAccount.update({
      where: { id: accountId },
      data: { disabled: true },
    });
    return false;
  }
}

/**
 * Mark an account as rate-limited for the configured cooldown period.
 */
export async function markRateLimited(accountId: string): Promise<void> {
  await prisma.oAuthAccount.update({
    where: { id: accountId },
    data: {
      rateLimitedUntil: new Date(Date.now() + getCooldownMs()),
    },
  });
}

/** Shape of entries in the OpenCode antigravity-accounts.json file. */
interface OpenCodeAccount {
  email: string;
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO date string
}

/**
 * Get the path to the OpenCode antigravity accounts file.
 */
export function getOpenCodeAccountsPath(): string {
  return join(homedir(), ".config", "opencode", "antigravity-accounts.json");
}

/**
 * Import tokens from OpenCode's antigravity-accounts.json into the database.
 * Returns the number of accounts imported/updated.
 * Does not overwrite accounts with source "browser".
 */
export async function importOpenCodeTokens(): Promise<number> {
  const filePath = getOpenCodeAccountsPath();
  if (!existsSync(filePath)) return 0;

  let accounts: OpenCodeAccount[];
  try {
    const raw = readFileSync(filePath, "utf-8");
    accounts = JSON.parse(raw);
  } catch {
    return 0;
  }

  if (!Array.isArray(accounts)) return 0;

  let imported = 0;
  for (const acct of accounts) {
    if (!acct.email || !acct.access_token || !acct.refresh_token) continue;

    // Don't overwrite browser-authed accounts
    const existing = await prisma.oAuthAccount.findUnique({
      where: { provider_email: { provider: PROVIDER, email: acct.email } },
    });
    if (existing && existing.source === "browser") continue;

    await prisma.oAuthAccount.upsert({
      where: { provider_email: { provider: PROVIDER, email: acct.email } },
      create: {
        provider: PROVIDER,
        email: acct.email,
        accessToken: encrypt(acct.access_token),
        refreshToken: encrypt(acct.refresh_token),
        expiresAt: new Date(acct.expires_at),
        source: "opencode",
      },
      update: {
        accessToken: encrypt(acct.access_token),
        refreshToken: encrypt(acct.refresh_token),
        expiresAt: new Date(acct.expires_at),
        source: "opencode",
      },
    });
    imported++;
  }

  return imported;
}

/**
 * Return stats about Antigravity account availability.
 */
export async function getAccountCount(): Promise<{
  total: number;
  available: number;
  rateLimited: number;
  disabled: number;
}> {
  const now = new Date();

  const [total, disabled, rateLimited] = await Promise.all([
    prisma.oAuthAccount.count({ where: { provider: PROVIDER } }),
    prisma.oAuthAccount.count({ where: { provider: PROVIDER, disabled: true } }),
    prisma.oAuthAccount.count({
      where: {
        provider: PROVIDER,
        disabled: false,
        rateLimitedUntil: { gt: now },
      },
    }),
  ]);

  return {
    total,
    available: total - disabled - rateLimited,
    rateLimited,
    disabled,
  };
}
