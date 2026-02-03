/*
  Warnings:

  - You are about to drop the column `embedding` on the `Memory` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Memory_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "Memory" DROP COLUMN "embedding";

-- CreateTable
CREATE TABLE "StandupMessage" (
    "id" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "fromAgent" TEXT NOT NULL,
    "fromRole" TEXT,
    "toAgent" TEXT NOT NULL,
    "insightType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actionable" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "model" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "tokensUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandupMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "fromAgent" TEXT NOT NULL,
    "fromRole" TEXT,
    "toAgent" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "rateLimitedUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StandupMessage_pipelineRunId_idx" ON "StandupMessage"("pipelineRunId");

-- CreateIndex
CREATE INDEX "StandupMessage_insightType_idx" ON "StandupMessage"("insightType");

-- CreateIndex
CREATE INDEX "StandupMessage_fromAgent_idx" ON "StandupMessage"("fromAgent");

-- CreateIndex
CREATE INDEX "AgentMessage_pipelineRunId_toAgent_idx" ON "AgentMessage"("pipelineRunId", "toAgent");

-- CreateIndex
CREATE INDEX "AgentMessage_parentId_idx" ON "AgentMessage"("parentId");

-- CreateIndex
CREATE INDEX "OAuthAccount_provider_disabled_idx" ON "OAuthAccount"("provider", "disabled");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_email_key" ON "OAuthAccount"("provider", "email");

-- AddForeignKey
ALTER TABLE "StandupMessage" ADD CONSTRAINT "StandupMessage_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AgentMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
