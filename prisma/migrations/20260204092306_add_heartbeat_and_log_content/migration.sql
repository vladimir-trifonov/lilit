-- AlterTable
ALTER TABLE "PipelineRun" ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "logContent" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "sessionId" TEXT;
