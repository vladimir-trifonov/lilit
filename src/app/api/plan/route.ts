import { NextResponse } from "next/server";
import { findPendingPlan, writeConfirmation } from "@/lib/plan-gate";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ status: "none" });
  }

  const pending = findPendingPlan(projectId);

  if (!pending) {
    return NextResponse.json({ status: "none" });
  }

  return NextResponse.json({
    status: "pending",
    runId: pending.runId,
    plan: pending.plan,
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { projectId, runId, action, notes } = body;

  if (!projectId || !runId || !action) {
    return NextResponse.json(
      { error: "projectId, runId and action are required" },
      { status: 400 }
    );
  }

  if (!["confirm", "reject", "modify"].includes(action)) {
    return NextResponse.json(
      { error: "action must be confirm, reject, or modify" },
      { status: 400 }
    );
  }

  writeConfirmation(projectId, runId, action, notes);

  return NextResponse.json({ success: true, action });
}
