ALTER TABLE "recovery_copy" DROP CONSTRAINT "recovery_copy_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "recovery_copy" DROP CONSTRAINT "recovery_copy_target_postgres_id_postgres_postgres_id_fk";
--> statement-breakpoint
ALTER TABLE "recovery_copy" DROP CONSTRAINT "recovery_copy_environment_id_environment_environment_id_fk";
--> statement-breakpoint
ALTER TABLE "recovery_copy" ADD COLUMN "origin_volume_created_at" text;--> statement-breakpoint
ALTER TABLE "recovery_copy" ADD CONSTRAINT "recovery_copy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_copy" ADD CONSTRAINT "recovery_copy_target_postgres_id_postgres_postgres_id_fk" FOREIGN KEY ("target_postgres_id") REFERENCES "public"."postgres"("postgres_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_copy" ADD CONSTRAINT "recovery_copy_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE restrict ON UPDATE no action;