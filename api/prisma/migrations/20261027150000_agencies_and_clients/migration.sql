-- CreateEnum
CREATE TYPE "KeywordMode" AS ENUM ('present', 'absent');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('agency_admin', 'client_viewer');

-- CreateEnum
CREATE TYPE "DomainSource" AS ENUM ('rdap', 'manual');

-- CreateEnum
CREATE TYPE "ExpiryKind" AS ENUM ('certificate', 'domain');

-- AlterEnum
ALTER TYPE "MonitorType" ADD VALUE 'keyword';

-- AlterTable
ALTER TABLE "monitors" ADD COLUMN     "client_id" UUID,
ADD COLUMN     "keyword" TEXT,
ADD COLUMN     "keyword_case_sensitive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "keyword_mode" "KeywordMode",
ADD COLUMN     "organization_id" UUID;

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_email" TEXT,
    "brand_color" TEXT NOT NULL DEFAULT '#818CF8',
    "logo_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID,
    "role" "MembershipRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "monitor_id" UUID NOT NULL,
    "issuer" TEXT,
    "subject" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "authorized" BOOLEAN NOT NULL,
    "error" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("monitor_id")
);

-- CreateTable
CREATE TABLE "domains" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID,
    "domain" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "source" "DomainSource" NOT NULL DEFAULT 'rdap',
    "error" TEXT,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expiry_notices" (
    "id" BIGSERIAL NOT NULL,
    "kind" "ExpiryKind" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "threshold" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expiry_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_name_key" ON "clients"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_key" ON "memberships"("user_id");

-- CreateIndex
CREATE INDEX "memberships_organization_id_idx" ON "memberships"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "domains_organization_id_domain_key" ON "domains"("organization_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "expiry_notices_kind_subject_id_expires_at_threshold_key" ON "expiry_notices"("kind", "subject_id", "expires_at", "threshold");

-- CreateIndex
CREATE INDEX "monitors_organization_id_client_id_idx" ON "monitors"("organization_id", "client_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domains" ADD CONSTRAINT "domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domains" ADD CONSTRAINT "domains_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: every existing account becomes a one-person agency that owns the monitors it
-- created. The new organization reuses the user's id, which keeps this a plain INSERT.
INSERT INTO "organizations" ("id", "name") SELECT "id", "name" FROM "users";
INSERT INTO "memberships" ("id", "user_id", "organization_id", "role")
  SELECT gen_random_uuid(), "id", "id", 'agency_admin' FROM "users";
UPDATE "monitors" SET "organization_id" = "owner_id";
ALTER TABLE "monitors" ALTER COLUMN "organization_id" SET NOT NULL;
