/*
  Warnings:

  - You are about to drop the column `taskId` on the `AgentRun` table. All the data in the column will be lost.
  - You are about to drop the `Task` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_taskId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_projectId_fkey";

-- DropIndex
DROP INDEX "AgentRun_taskId_idx";

-- AlterTable
ALTER TABLE "AgentRun" DROP COLUMN "taskId";

-- DropTable
DROP TABLE "Task";
