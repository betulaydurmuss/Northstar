-- CreateEnum
CREATE TYPE "IncidentUpdateStatus" AS ENUM ('investigating', 'identified', 'monitoring', 'resolved');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('queued', 'ready', 'failed');

-- AlterEnum
ALTER TYPE "MonitorState" ADD VALUE 'maintenance';

-- AlterTable
ALTER TABLE "check_results" ADD COLUMN     "maintenance" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "status_pages" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "custom_domain" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_monitors" (
    "status_page_id" UUID NOT NULL,
    "monitor_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "display_name" TEXT,
    "group_name" TEXT,

    CONSTRAINT "status_page_monitors_pkey" PRIMARY KEY ("status_page_id","monitor_id")
);

-- CreateTable
CREATE TABLE "maintenance_windows" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_updates" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "status" "IncidentUpdateStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'queued',
    "file_path" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "status_pages_client_id_key" ON "status_pages"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "status_pages_slug_key" ON "status_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "status_pages_custom_domain_key" ON "status_pages"("custom_domain");

-- CreateIndex
CREATE INDEX "maintenance_windows_client_id_starts_at_idx" ON "maintenance_windows"("client_id", "starts_at");

-- CreateIndex
CREATE INDEX "incident_updates_incident_id_created_at_idx" ON "incident_updates"("incident_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reports_client_id_period_key" ON "reports"("client_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "invites_client_id_idx" ON "invites"("client_id");

-- AddForeignKey
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_monitors" ADD CONSTRAINT "status_page_monitors_status_page_id_fkey" FOREIGN KEY ("status_page_id") REFERENCES "status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_monitors" ADD CONSTRAINT "status_page_monitors_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

