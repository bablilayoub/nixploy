ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "organization_name" text;--> statement-breakpoint
-- Backfill the denormalised name so existing rows stay readable after an
-- organization is deleted (the FK below becomes ON DELETE SET NULL).
UPDATE "audit_log" SET "organization_name" = "organization"."name" FROM "organization" WHERE "audit_log"."organization_id" = "organization"."id";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "allow_private_egress" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");