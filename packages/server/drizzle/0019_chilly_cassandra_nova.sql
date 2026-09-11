-- 0019: `queued` deployment status + hot-path indexes (audit 2026-09, architecture #1/#9).
--
-- Transaction constraint: both migration runners (drizzle-kit `migrate` and the
-- production `docker/migrate.mjs` → drizzle-orm migrator) apply EVERY pending file
-- inside ONE transaction. Postgres (12+) allows `ALTER TYPE ... ADD VALUE` inside a
-- transaction but refuses to *use* the new label before commit ("unsafe use of new
-- value"), so nothing in this file — and nothing in any later file that could land
-- in the same run (fresh installs apply 0000..N together) — may reference 'queued':
--   * the partial index below lists the TERMINAL labels instead of
--     `IN ('queued','running')`; the planner still proves `status = 'running'` /
--     `status IN ('queued','running')` imply the predicate (verified with EXPLAIN);
--   * the column default stays 'running' (a `SET DEFAULT 'queued'` would trip the
--     same check) — the queue inserts the status explicitly.
-- `IF NOT EXISTS` keeps the enum change idempotent for hand-repaired databases.
ALTER TYPE "public"."deployment_status" ADD VALUE IF NOT EXISTS 'queued' BEFORE 'running';--> statement-breakpoint
CREATE INDEX "deployment_active_status_idx" ON "deployment" USING btree ("status") WHERE "status" NOT IN ('done', 'error', 'cancelled');--> statement-breakpoint
CREATE INDEX "deployment_created_idx" ON "deployment" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deployment_schedule_created_idx" ON "deployment" USING btree ("schedule_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "preview_deployment_application_id_idx" ON "preview_deployment" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "rollback_application_id_idx" ON "rollback" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "alert_rule_application_id_idx" ON "alert_rule" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "alert_rule_compose_id_idx" ON "alert_rule" USING btree ("compose_id");--> statement-breakpoint
CREATE INDEX "incident_org_created_idx" ON "incident" USING btree ("organization_id","created_at" DESC NULLS LAST);