ALTER TABLE "compose" ADD COLUMN "build_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "build_args" text;