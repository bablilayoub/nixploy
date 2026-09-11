CREATE TABLE "status_page" (
	"status_page_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"token" text NOT NULL,
	"title" text DEFAULT 'Status' NOT NULL,
	"probe_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_page_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "status_page_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "preview_env" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "preview_limit" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "preview_ttl_hours" integer;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "auto_update_image" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "push_registry_id" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "pre_deploy_command" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "post_deploy_command" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "pre_deploy_command" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "post_deploy_command" text;--> statement-breakpoint
ALTER TABLE "incident" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incident" ADD COLUMN "acknowledged_by" text;--> statement-breakpoint
ALTER TABLE "status_page" ADD CONSTRAINT "status_page_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_push_registry_id_registry_registry_id_fk" FOREIGN KEY ("push_registry_id") REFERENCES "public"."registry"("registry_id") ON DELETE set null ON UPDATE no action;