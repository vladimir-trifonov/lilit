import { NextResponse } from "next/server";
import { findPendingPlan, writeConfirmation } from "@/lib/plan-gate";

export const dynamic = "force-dynamic";

export async function GET() {
  const pending = findPendingPlan();

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
  const { runId, action, notes } = body;

  if (!runId || !action) {
    return NextResponse.json(
      { error: "runId and action are required" },
      { status: 400 }
    );
  }

  if (!["confirm", "reject", "modify"].includes(action)) {
    return NextResponse.json(
      { error: "action must be confirm, reject, or modify" },
      { status: 400 }
    );
  }

  writeConfirmation(runId, action, notes);

  return NextResponse.json({ success: true, action });
}
