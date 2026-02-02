-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "plan" TEXT,
    "pipeline" TEXT,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "completedSteps" TEXT,
    "lastOutput" TEXT,
    "fixCycle" INTEGER NOT NULL DEFAULT 0,
    "runningCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PipelineRun_runId_key" ON "PipelineRun"("runId");

-- CreateIndex
CREATE INDEX "PipelineRun_projectId_status_idx" ON "PipelineRun"("projectId", "status");

-- CreateIndex
CREATE INDEX "PipelineRun_runId_idx" ON "PipelineRun"("runId");

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
