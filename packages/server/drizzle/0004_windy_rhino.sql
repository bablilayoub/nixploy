CREATE TYPE "public"."swarm_role" AS ENUM('worker', 'manager');--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "is_preview_deployments_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "swarm_role" "swarm_role" DEFAULT 'worker' NOT NULL;