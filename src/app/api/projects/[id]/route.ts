import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/projects/:id — soft-delete a project.
 * Sets `deletedAt` timestamp; does NOT remove files from disk.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.deletedAt) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await prisma.project.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
