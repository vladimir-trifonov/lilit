-- AlterTable
ALTER TABLE "AgentMessage" ADD COLUMN     "debateId" TEXT,
ADD COLUMN     "debateRole" TEXT;

-- CreateTable
CREATE TABLE "DebateRound" (
    "id" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "challengerAgent" TEXT NOT NULL,
    "defenderAgent" TEXT NOT NULL,
    "triggerOpinion" TEXT NOT NULL,
    "conflictSnippet" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "turnCount" INTEGER NOT NULL,
    "resolutionNote" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stepIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebateRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DebateRound_pipelineRunId_idx" ON "DebateRound"("pipelineRunId");

-- CreateIndex
CREATE INDEX "AgentMessage_debateId_idx" ON "AgentMessage"("debateId");

-- AddForeignKey
ALTER TABLE "DebateRound" ADD CONSTRAINT "DebateRound_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
