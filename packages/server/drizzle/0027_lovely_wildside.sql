CREATE TYPE "public"."schedule_run_mode" AS ENUM('exec', 'image');--> statement-breakpoint
CREATE TYPE "public"."template_source_kind" AS ENUM('git', 'http-json');--> statement-breakpoint
CREATE TABLE "compose_deployment_snapshot" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"compose_id" text NOT NULL,
	"source_file" text NOT NULL,
	"rendered_file" text NOT NULL,
	"service_env" text,
	"merged_env" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compose_deployment_snapshot_deployment_id_unique" UNIQUE("deployment_id")
);
--> statement-breakpoint
CREATE TABLE "template_source" (
	"template_source_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"kind" "template_source_kind" DEFAULT 'http-json' NOT NULL,
	"branch" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"template_count" integer DEFAULT 0 NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "commit_message" text;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "commit_author" text;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "commit_url" text;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "run_mode" "schedule_run_mode" DEFAULT 'exec' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "compose_deployment_snapshot" ADD CONSTRAINT "compose_deployment_snapshot_deployment_id_deployment_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment"("deployment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose_deployment_snapshot" ADD CONSTRAINT "compose_deployment_snapshot_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_source" ADD CONSTRAINT "template_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compose_snapshot_compose_created_idx" ON "compose_deployment_snapshot" USING btree ("compose_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "template_source_organization_id_idx" ON "template_source" USING btree ("organization_id");