import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { detectStack, validateProjectPath } from "@/lib/stack-detector";
import { DEFAULT_SETTINGS } from "@/types/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { conversations: true, tasks: true } },
    },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, path, description, stack } = body as {
      name: string;
      path: string;
      description?: string;
      stack?: string;
    };

    if (!name || !path) {
      return NextResponse.json(
        { error: "name and path are required" },
        { status: 400 }
      );
    }

    // Validate path
    const validation = validateProjectPath(path);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Invalid project path" },
        { status: 400 }
      );
    }

    // Auto-detect stack if not provided
    let detectedStack = stack;
    if (!detectedStack) {
      const detected = await detectStack(path);
      detectedStack = detected || undefined;
    }

    // Create project with default settings
    const project = await prisma.project.create({
      data: {
        name,
        path,
        description,
        stack: detectedStack,
        settings: JSON.stringify(DEFAULT_SETTINGS),
      },
    });

    // Create initial conversation
    await prisma.conversation.create({
      data: { projectId: project.id },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Project creation error:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
