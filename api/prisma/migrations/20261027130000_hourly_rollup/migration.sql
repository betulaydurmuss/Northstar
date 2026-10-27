-- CreateTable
CREATE TABLE "check_results_hourly" (
    "monitor_id" UUID NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "up_count" INTEGER NOT NULL,
    "total_count" INTEGER NOT NULL,
    "avg_ms" DOUBLE PRECISION,
    "p95_ms" DOUBLE PRECISION,
    "ms_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "check_results_hourly_pkey" PRIMARY KEY ("monitor_id","hour")
);

-- AddForeignKey
ALTER TABLE "check_results_hourly" ADD CONSTRAINT "check_results_hourly_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

