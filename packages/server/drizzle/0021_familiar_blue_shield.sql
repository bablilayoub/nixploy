CREATE TYPE "public"."domain_middleware_kind" AS ENUM('rateLimit', 'ipAllowList', 'headers', 'compress', 'forwardAuth', 'stickyCookie', 'maintenance');--> statement-breakpoint
CREATE TABLE "domain_middleware" (
	"domain_middleware_id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"kind" "domain_middleware_kind" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redirect" ALTER COLUMN "application_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "security" ALTER COLUMN "application_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "redirect" ADD COLUMN "compose_id" text;--> statement-breakpoint
ALTER TABLE "redirect" ADD COLUMN "service_name" text;--> statement-breakpoint
ALTER TABLE "security" ADD COLUMN "compose_id" text;--> statement-breakpoint
ALTER TABLE "security" ADD COLUMN "service_name" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "acme_dns_provider" text;--> statement-breakpoint
ALTER TABLE "web_server_settings" ADD COLUMN "acme_dns_credentials" text;--> statement-breakpoint
ALTER TABLE "domain_middleware" ADD CONSTRAINT "domain_middleware_domain_id_domain_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("domain_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_middleware_domain_id_idx" ON "domain_middleware" USING btree ("domain_id");--> statement-breakpoint
ALTER TABLE "redirect" ADD CONSTRAINT "redirect_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security" ADD CONSTRAINT "security_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirect" ADD CONSTRAINT "redirect_compose_regex_unique" UNIQUE("compose_id","service_name","regex");--> statement-breakpoint
ALTER TABLE "security" ADD CONSTRAINT "security_compose_username_unique" UNIQUE("compose_id","service_name","username");--> statement-breakpoint
ALTER TABLE "redirect" ADD CONSTRAINT "redirect_one_parent" CHECK (("redirect"."application_id" is not null)::int + ("redirect"."compose_id" is not null)::int = 1);--> statement-breakpoint
ALTER TABLE "redirect" ADD CONSTRAINT "redirect_compose_service_name" CHECK ("redirect"."compose_id" is null or "redirect"."service_name" is not null);--> statement-breakpoint
ALTER TABLE "security" ADD CONSTRAINT "security_one_parent" CHECK (("security"."application_id" is not null)::int + ("security"."compose_id" is not null)::int = 1);--> statement-breakpoint
ALTER TABLE "security" ADD CONSTRAINT "security_compose_service_name" CHECK ("security"."compose_id" is null or "security"."service_name" is not null);