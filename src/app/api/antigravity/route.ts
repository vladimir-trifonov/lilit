/**
 * Antigravity accounts management API.
 * GET  — List all accounts with stats.
 * POST — Import tokens from OpenCode.
 * DELETE — Remove an account.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importOpenCodeTokens, getAccountCount } from "@/lib/antigravity-tokens";

export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await prisma.oAuthAccount.findMany({
    where: { provider: "antigravity" },
    select: {
      id: true,
      email: true,
      source: true,
      disabled: true,
      rateLimitedUntil: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const stats = await getAccountCount();

  return NextResponse.json({ accounts, stats });
}

export async function POST(req: Request) {
  const body = await req.json() as { action?: string; id?: string; disabled?: boolean };

  if (body.action === "import") {
    const count = await importOpenCodeTokens();
    const stats = await getAccountCount();
    return NextResponse.json({ imported: count, stats });
  }

  if (body.action === "toggle" && body.id) {
    await prisma.oAuthAccount.update({
      where: { id: body.id },
      data: { disabled: body.disabled ?? false },
    });
    const stats = await getAccountCount();
    return NextResponse.json({ ok: true, stats });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  await prisma.oAuthAccount.delete({ where: { id } }).catch(() => {
    // Account may already be deleted
  });

  return NextResponse.json({ ok: true });
}
