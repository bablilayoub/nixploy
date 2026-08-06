CREATE INDEX "application_environment_id_idx" ON "application" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "member_user_org_idx" ON "member" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "compose_environment_id_idx" ON "compose" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "deployment_app_created_idx" ON "deployment" USING btree ("application_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deployment_compose_created_idx" ON "deployment" USING btree ("compose_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "domain_application_id_idx" ON "domain" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "domain_compose_id_idx" ON "domain" USING btree ("compose_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_log_search_vector_idx" ON "service_log" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "service_log_org_created_idx" ON "service_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "environment_project_id_idx" ON "environment" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_organization_id_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "server_organization_id_idx" ON "server" USING btree ("organization_id");