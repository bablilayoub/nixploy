ALTER TYPE "public"."preview_kind" ADD VALUE 'image';--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD COLUMN "image" text;