ALTER TABLE "application" ADD COLUMN "preview_database_kind" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "preview_database_id" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "preview_seed_command" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "preview_database_kind" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "preview_database_id" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "preview_seed_command" text;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "preview_database_logical_id" text;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "preview_seed_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_preview_database_logical_id_database_logical_database_logical_id_fk" FOREIGN KEY ("preview_database_logical_id") REFERENCES "public"."database_logical"("database_logical_id") ON DELETE set null ON UPDATE no action;