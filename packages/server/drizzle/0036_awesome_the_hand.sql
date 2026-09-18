CREATE TABLE "sso_provider" (
	"sso_provider_id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"preset" text DEFAULT 'custom' NOT NULL,
	"name" text NOT NULL,
	"issuer" text,
	"authorization_url" text,
	"token_url" text,
	"user_info_url" text,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"scopes" jsonb DEFAULT '["openid","profile","email"]'::jsonb NOT NULL,
	"allowed_email_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_organization_id" text,
	"default_role" text DEFAULT 'member' NOT NULL,
	"group_claim" text,
	"group_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_role_on_login" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "require_sso" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_default_organization_id_organization_id_fk" FOREIGN KEY ("default_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;