CREATE TYPE "public"."preview_kind" AS ENUM('pull_request', 'branch');--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "kind" "preview_kind" DEFAULT 'pull_request' NOT NULL;