/**
 * Project settings API
 * GET /api/settings?projectId=xxx - Get project settings
 * PUT /api/settings - Update project settings
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { parseSettings, type ProjectSettings } from "@/types/settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { settings: true, stack: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const settings = parseSettings(project.settings);

    // Merge stack from project if not in settings
    if (project.stack && !settings.stack) {
      settings.stack = project.stack ?? undefined;
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Settings GET error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { projectId, settings } = body as {
      projectId: string;
      settings: ProjectSettings;
    };

    if (!projectId || !settings) {
      return NextResponse.json(
        { error: "projectId and settings are required" },
        { status: 400 }
      );
    }

    // Update project with new settings
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        settings: JSON.stringify(settings),
        stack: settings.stack ?? null,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      settings: parseSettings(updated.settings),
    });
  } catch (error) {
    console.error("Settings PUT error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
