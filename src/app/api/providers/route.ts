import { NextResponse } from "next/server";
import { getAvailableProviders } from "@/lib/providers/index";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get("refresh") === "true";

  const providers = await getAvailableProviders(refresh);
  return NextResponse.json({ providers });
}
