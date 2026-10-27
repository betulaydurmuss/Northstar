-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suspended_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "details" JSONB;

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_monitors" INTEGER NOT NULL,
    "max_clients" INTEGER NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- The plans every existing agency can be on; organizations default to starter.
INSERT INTO "plans" ("id", "name", "max_monitors", "max_clients") VALUES
  ('starter', 'Starter', 50, 10),
  ('agency', 'Agency', 500, 100),
  ('enterprise', 'Enterprise', 5000, 1000);

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_fkey" FOREIGN KEY ("plan") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

