CREATE TABLE "instance_branding" (
	"instance_branding_id" text PRIMARY KEY NOT NULL,
	"product_name" text,
	"accent_color" text,
	"logo_light_file" text,
	"logo_dark_file" text,
	"favicon_file" text,
	"footer_text" text,
	"support_url" text,
	"docs_url" text,
	"email_from_name" text,
	"custom_css" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
