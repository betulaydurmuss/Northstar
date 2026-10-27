-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_last_epoch" INTEGER;

-- AlterTable
ALTER TABLE "status_pages" ADD COLUMN     "domain_verified_at" TIMESTAMP(3);
