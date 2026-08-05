--> Notification channel configs move from jsonb to AES-encrypted text.
--> Existing rows keep their plaintext JSON (decrypt() passes it through) and
--> are re-encrypted on their next write.
ALTER TABLE "notification" ALTER COLUMN "slack_config" SET DATA TYPE text USING "slack_config"::text;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "telegram_config" SET DATA TYPE text USING "telegram_config"::text;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "discord_config" SET DATA TYPE text USING "discord_config"::text;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "email_config" SET DATA TYPE text USING "email_config"::text;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "gotify_config" SET DATA TYPE text USING "gotify_config"::text;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "ntfy_config" SET DATA TYPE text USING "ntfy_config"::text;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "pushover_config" SET DATA TYPE text USING "pushover_config"::text;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "custom_config" SET DATA TYPE text USING "custom_config"::text;--> statement-breakpoint
--> Certificates gain an owning organization. Pre-existing rows were shared
--> across every tenant; adopt them into the oldest organization (the only one
--> on a typical single-org install) so the column can be NOT NULL.
ALTER TABLE "certificate" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "certificate" SET "organization_id" = (
	SELECT "id" FROM "organization" ORDER BY "created_at" ASC LIMIT 1
) WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "certificate" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "certificate" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
