-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pipelineRunId" TEXT,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "acceptanceCriteria" TEXT[],
    "skills" TEXT[],
    "assignedAgent" TEXT,
    "assignedRole" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "sequenceOrder" INTEGER NOT NULL DEFAULT 0,
    "output" TEXT,
    "outputSummary" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskNote" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_pipelineRunId_idx" ON "Task"("pipelineRunId");

-- CreateIndex
CREATE INDEX "Task_assignedAgent_idx" ON "Task"("assignedAgent");

-- CreateIndex
CREATE INDEX "TaskNote_taskId_idx" ON "TaskNote"("taskId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNote" ADD CONSTRAINT "TaskNote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
