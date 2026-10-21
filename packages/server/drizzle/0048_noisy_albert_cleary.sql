-- A configuration-storage transition cannot overlap old deployment side effects.
-- Stop and drain ALL old panel/worker processes before applying this migration.
LOCK TABLE "deployment" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "organization") AND current_setting('nixploy.upgrade_0048_drained', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Use the current host updater to drain all old panels and workers before migration 0048';
  END IF;
  IF EXISTS (SELECT 1 FROM "deployment" WHERE "status"::text = 'running') THEN
    RAISE EXCEPTION 'Drain running deployments before the encrypted organization-variable upgrade';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "deployment_environment_snapshot" (
	"deployment_id" text PRIMARY KEY NOT NULL,
	"runtime_env" text NOT NULL,
	"service_env" text NOT NULL,
	"build_args" text,
	"source_fingerprint" text NOT NULL,
	"release_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_environment" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"env" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_copy" (
	"recovery_copy_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" text NOT NULL,
	"backup_id" text,
	"source_postgres_id" text,
	"target_postgres_id" text,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"object_key" text NOT NULL,
	"status" text DEFAULT 'validating' NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"table_count" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organization" RENAME COLUMN "metadata" TO "metadata_v2";--> statement-breakpoint
ALTER TABLE "deployment_environment_snapshot" ADD CONSTRAINT "deployment_environment_snapshot_deployment_id_deployment_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment"("deployment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_environment" ADD CONSTRAINT "organization_environment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_copy" ADD CONSTRAINT "recovery_copy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_copy" ADD CONSTRAINT "recovery_copy_backup_id_backup_backup_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."backup"("backup_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_copy" ADD CONSTRAINT "recovery_copy_source_postgres_id_postgres_postgres_id_fk" FOREIGN KEY ("source_postgres_id") REFERENCES "public"."postgres"("postgres_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_copy" ADD CONSTRAINT "recovery_copy_target_postgres_id_postgres_postgres_id_fk" FOREIGN KEY ("target_postgres_id") REFERENCES "public"."postgres"("postgres_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_copy" ADD CONSTRAINT "recovery_copy_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_environment_release_idx" ON "deployment_environment_snapshot" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_copy_request_idx" ON "recovery_copy" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "recovery_copy_backup_idx" ON "recovery_copy" USING btree ("backup_id","created_at");
--> statement-breakpoint
-- Old workers cannot silently deploy without the new organization layer/snapshot.
CREATE FUNCTION nixploy_require_environment_protocol() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status::text = 'running' AND NEW.app_name IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'running' THEN
      IF current_setting('nixploy.environment_snapshot_protocol', true) IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'This deployment worker predates encrypted organization variables; upgrade it before claiming jobs';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER deployment_environment_protocol
BEFORE INSERT OR UPDATE OF status ON "deployment"
FOR EACH ROW EXECUTE FUNCTION nixploy_require_environment_protocol();
--> statement-breakpoint
-- An older metadata writer must fail instead of restoring plaintext secrets.
CREATE FUNCTION nixploy_reject_legacy_organization_env() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.metadata_v2 IS NOT NULL AND NEW.metadata_v2::jsonb ? 'env' THEN
    RAISE EXCEPTION 'Store organization variables through the encrypted environment API';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER organization_environment_storage
BEFORE INSERT OR UPDATE OF metadata_v2 ON "organization"
FOR EACH ROW EXECUTE FUNCTION nixploy_reject_legacy_organization_env();
