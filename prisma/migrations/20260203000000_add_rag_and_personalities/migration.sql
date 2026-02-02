-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agent" TEXT,
    "role" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "significance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRelationship" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromAgent" TEXT NOT NULL,
    "toAgent" TEXT NOT NULL,
    "trust" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "tension" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "rapport" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "lastNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Memory_projectId_type_idx" ON "Memory"("projectId", "type");

-- CreateIndex
CREATE INDEX "Memory_projectId_agent_idx" ON "Memory"("projectId", "agent");

-- CreateIndex
CREATE INDEX "Memory_sourceType_sourceId_idx" ON "Memory"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRelationship_projectId_fromAgent_toAgent_key" ON "AgentRelationship"("projectId", "fromAgent", "toAgent");

-- CreateIndex
CREATE INDEX "AgentRelationship_projectId_idx" ON "AgentRelationship"("projectId");

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRelationship" ADD CONSTRAINT "AgentRelationship_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add vector column (not managed by Prisma)
ALTER TABLE "Memory" ADD COLUMN "embedding" vector(768);

-- HNSW index for fast cosine similarity search
CREATE INDEX "Memory_embedding_hnsw_idx" ON "Memory"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
