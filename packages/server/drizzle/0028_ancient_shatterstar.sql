ALTER TABLE "preview_deployment" ALTER COLUMN "application_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "is_preview_deployments_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "preview_forks_require_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "preview_env" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "preview_limit" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "preview_ttl_hours" integer;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "compose_id" text;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preview_deployment_compose_id_idx" ON "preview_deployment" USING btree ("compose_id");--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_one_parent" CHECK (("application_id" IS NOT NULL) <> ("compose_id" IS NOT NULL));