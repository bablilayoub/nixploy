ALTER TYPE "public"."database_type" ADD VALUE 'redis' BEFORE 'web-server';--> statement-breakpoint
ALTER TABLE "backup" ADD COLUMN "redis_id" text;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_redis_id_redis_redis_id_fk" FOREIGN KEY ("redis_id") REFERENCES "public"."redis"("redis_id") ON DELETE cascade ON UPDATE no action;