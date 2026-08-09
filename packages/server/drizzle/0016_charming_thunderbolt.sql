ALTER TYPE "public"."preview_status" ADD VALUE 'awaiting_approval';--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "preview_forks_require_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "pull_request_author" text;