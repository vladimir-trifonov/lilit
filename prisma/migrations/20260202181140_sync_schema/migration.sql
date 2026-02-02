-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "role" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "settings" TEXT,
ADD COLUMN     "stack" TEXT;

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "agent" TEXT NOT NULL,
    "role" TEXT,
    "type" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLog_projectId_createdAt_idx" ON "EventLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "EventLog_taskId_idx" ON "EventLog"("taskId");

-- CreateIndex
CREATE INDEX "EventLog_type_idx" ON "EventLog"("type");

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
