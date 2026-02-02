-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "pipelineRunId" TEXT;

-- CreateIndex
CREATE INDEX "AgentRun_pipelineRunId_idx" ON "AgentRun"("pipelineRunId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
