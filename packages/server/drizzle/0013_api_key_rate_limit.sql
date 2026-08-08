-- Enable API key rate limiting by default (and backfill existing keys).
ALTER TABLE "apikey" ALTER COLUMN "rate_limit_enabled" SET DEFAULT true;
ALTER TABLE "apikey" ALTER COLUMN "rate_limit_time_window" SET DEFAULT 60000;
ALTER TABLE "apikey" ALTER COLUMN "rate_limit_max" SET DEFAULT 120;
UPDATE "apikey" SET "rate_limit_enabled" = true WHERE "rate_limit_enabled" = false;
UPDATE "apikey" SET "rate_limit_time_window" = 60000 WHERE "rate_limit_time_window" IS NULL;
UPDATE "apikey" SET "rate_limit_max" = 120 WHERE "rate_limit_max" IS NULL;
