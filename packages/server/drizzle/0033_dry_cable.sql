CREATE TABLE "service_event" (
	"service_event_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"service_type" text NOT NULL,
	"service_id" text NOT NULL,
	"app_name" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"deployment_id" text,
	"actor_id" text,
	"actor_email" text,
	"dedupe_key" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_event_service_idx" ON "service_event" USING btree ("service_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_event_org_created_idx" ON "service_event" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "service_event_dedupe_idx" ON "service_event" USING btree ("service_id","dedupe_key");