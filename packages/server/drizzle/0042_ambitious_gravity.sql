ALTER TYPE "public"."domain_type" ADD VALUE 'external';--> statement-breakpoint
CREATE TABLE "external_upstream" (
	"external_upstream_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_name" text NOT NULL,
	"description" text,
	"target_url" text NOT NULL,
	"pass_host_header" boolean DEFAULT true NOT NULL,
	"insecure_skip_verify" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"environment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "external_upstream_id" text;--> statement-breakpoint
ALTER TABLE "external_upstream" ADD CONSTRAINT "external_upstream_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_upstream_app_name_unique" ON "external_upstream" USING btree ("app_name");--> statement-breakpoint
CREATE INDEX "external_upstream_environment_id_idx" ON "external_upstream" USING btree ("environment_id");--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_external_upstream_id_external_upstream_external_upstream_id_fk" FOREIGN KEY ("external_upstream_id") REFERENCES "public"."external_upstream"("external_upstream_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_external_upstream_id_idx" ON "domain" USING btree ("external_upstream_id");