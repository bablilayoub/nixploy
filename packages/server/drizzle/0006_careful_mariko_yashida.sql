ALTER TYPE "public"."notification_type" ADD VALUE 'mattermost' BEFORE 'custom';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'lark' BEFORE 'custom';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'teams' BEFORE 'custom';--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "mattermost_config" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "lark_config" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "teams_config" text;