ALTER TABLE "backup" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volume_backup" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "app_name" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "preview_deployment_id" text;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint
-- Backfill in two passes (never a cross join): a deployment row points at an
-- application OR a compose service. Preview rows are left NULL on purpose —
-- their row names the PARENT application, so the parent's app_name would make
-- a legacy queued preview build the production service. NULL keeps them
-- invisible to the claim query, exactly as before 0023; boot recovery fails
-- them. Previews queued from now on carry their own name.
UPDATE "deployment" d SET "app_name" = a."app_name" FROM "application" a WHERE a."application_id" = d."application_id" AND d."is_preview" = false;--> statement-breakpoint
UPDATE "deployment" d SET "app_name" = c."app_name" FROM "compose" c WHERE c."compose_id" = d."compose_id" AND d."app_name" IS NULL;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_preview_deployment_id_preview_deployment_preview_deployment_id_fk" FOREIGN KEY ("preview_deployment_id") REFERENCES "public"."preview_deployment"("preview_deployment_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_queued_app_idx" ON "deployment" USING btree ("app_name") WHERE "status" NOT IN ('done', 'error', 'cancelled');
