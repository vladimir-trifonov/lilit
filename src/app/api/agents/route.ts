import { NextResponse } from "next/server";
import {
  getAgentRegistry,
  writeAgentFile,
  writeRoleFile,
  deleteAgentOrRole,
} from "@/lib/agent-loader";

export const dynamic = "force-dynamic";

export async function GET() {
  const registry = getAgentRegistry(true);
  return NextResponse.json({ agents: registry });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { type, role, frontmatter, systemPrompt } = body;

  if (!type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  if (role) {
    writeRoleFile(type, role, frontmatter ?? {}, systemPrompt ?? "");
  } else {
    writeAgentFile(type, frontmatter ?? {}, systemPrompt ?? "");
  }

  const registry = getAgentRegistry(true);
  return NextResponse.json({ success: true, agents: registry });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { type, name, description, provider, model, capabilities, tags, systemPrompt } = body;

  if (!type || !name) {
    return NextResponse.json({ error: "type and name are required" }, { status: 400 });
  }

  writeAgentFile(
    type,
    { name, type, description, provider, model, capabilities, tags },
    systemPrompt ?? ""
  );

  const registry = getAgentRegistry(true);
  return NextResponse.json({ success: true, agents: registry });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const role = searchParams.get("role");

  if (!type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  deleteAgentOrRole(type, role ?? undefined);

  const registry = getAgentRegistry(true);
  return NextResponse.json({ success: true, agents: registry });
}
