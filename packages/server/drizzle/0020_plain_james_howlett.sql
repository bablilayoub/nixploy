-- 0020: deployment provenance (commit sha/message/author, trigger, triggered_by)
-- and the `backup_run` history table (audit 2026-09, product gaps Deploy #1-2, Backups).
-- New enum types are created here and only used by columns in this same file:
-- CREATE TYPE + a column of that type in one transaction is fine (the 0019
-- caveat only applies to ALTER TYPE ... ADD VALUE).
CREATE TYPE "public"."backup_run_kind" AS ENUM('database', 'volume', 'instance');--> statement-breakpoint
CREATE TYPE "public"."backup_run_status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TYPE "public"."deployment_trigger" AS ENUM('manual', 'webhook', 'api', 'schedule', 'preview', 'rollback', 'redeploy', 'gitops', 'system');--> statement-breakpoint
CREATE TABLE "backup_run" (
	"backup_run_id" text PRIMARY KEY NOT NULL,
	"backup_id" text,
	"volume_backup_id" text,
	"organization_id" text NOT NULL,
	"kind" "backup_run_kind" NOT NULL,
	"status" "backup_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"bytes" bigint,
	"object_key" text,
	"destination_id" text,
	"error" text,
	"trigger" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "commit_message" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "commit_author" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "trigger" "deployment_trigger";--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "triggered_by" text;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_backup_id_backup_backup_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."backup"("backup_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_volume_backup_id_volume_backup_volume_backup_id_fk" FOREIGN KEY ("volume_backup_id") REFERENCES "public"."volume_backup"("volume_backup_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_destination_id_destination_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("destination_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_run_org_started_idx" ON "backup_run" USING btree ("organization_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "backup_run_backup_started_idx" ON "backup_run" USING btree ("backup_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "backup_run_volume_started_idx" ON "backup_run" USING btree ("volume_backup_id","started_at" DESC NULLS LAST);