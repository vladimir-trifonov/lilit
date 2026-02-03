-- AlterTable
ALTER TABLE "PipelineRun" ADD COLUMN     "decisionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taskGraph" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dependsOn" TEXT[],
ADD COLUMN     "graphId" TEXT,
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "UserPipelineMessage" (
    "id" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPipelineMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PMDecisionLog" (
    "id" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerData" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PMDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPipelineMessage_pipelineRunId_processed_idx" ON "UserPipelineMessage"("pipelineRunId", "processed");

-- CreateIndex
CREATE INDEX "PMDecisionLog_pipelineRunId_idx" ON "PMDecisionLog"("pipelineRunId");

-- AddForeignKey
ALTER TABLE "UserPipelineMessage" ADD CONSTRAINT "UserPipelineMessage_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PMDecisionLog" ADD CONSTRAINT "PMDecisionLog_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
