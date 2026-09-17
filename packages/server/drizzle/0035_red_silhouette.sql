ALTER TABLE "certificate" ADD COLUMN "expiry_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "certificate_expiry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate" DROP COLUMN "auto_renew";