import { relations } from "drizzle-orm";
import { index, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { compose } from "./compose";
import { deployments } from "./deployment";
import { createdAt, idColumn } from "./utils";

/**
 * What one compose deployment actually deployed (product audit, Databases
 * row "Rollbacks exist only for applications").
 *
 * Applications roll back to a pinned image; a compose stack has no single
 * image, so the rollback target is the *input* of the deploy: the compose
 * file that was rendered and the env that rendered it. The row is written by
 * `modules/compose/snapshot.ts#recordComposeSnapshot` right after
 * `prepareComposeFiles` renders, so it exists even for a deploy that fails
 * later.
 *
 * - `sourceFile` is what a rollback restores onto the compose row (the raw
 *   compose body for `sourceType = "raw"`; the file read out of the checkout
 *   for git sources, kept for diffing since the repository is the authority).
 * - `renderedFile` is `docker-compose.nixploy.yml` as Docker saw it —
 *   interpolated, hardened, networks injected. It carries resolved secrets,
 *   so it is encrypted and never returned to a caller without `secrets.read`.
 * - `serviceEnv` is the compose row's OWN env at deploy time; restoring it
 *   keeps project → environment → service inheritance intact.
 * - `mergedEnv` is the resolved env the render used, for display and for
 *   proving what a rollback will reproduce.
 *
 * Lives in its own file because it references both `compose` and
 * `deployment`, and `deployment` already imports `compose`.
 */
export const composeDeploymentSnapshots = pgTable(
	"compose_deployment_snapshot",
	{
		snapshotId: idColumn("snapshot_id"),
		/** One snapshot per deployment; the first writer wins (`onConflictDoNothing`). */
		deploymentId: text("deployment_id")
			.notNull()
			.unique()
			.references(() => deployments.deploymentId, { onDelete: "cascade" }),
		composeId: text("compose_id")
			.notNull()
			.references(() => compose.composeId, { onDelete: "cascade" }),
		/** Compose body a rollback restores onto the row. */
		sourceFile: encryptedText("source_file").notNull(),
		/** Fully rendered `docker-compose.nixploy.yml` (resolved secrets). */
		renderedFile: encryptedText("rendered_file").notNull(),
		/** The compose row's own `env` at deploy time. */
		serviceEnv: encryptedText("service_env"),
		/** Resolved project → environment → service env used by the render. */
		mergedEnv: encryptedText("merged_env"),
		createdAt: createdAt(),
	},
	(table) => [
		index("compose_snapshot_compose_created_idx").on(table.composeId, table.createdAt.desc()),
	],
);

export const composeDeploymentSnapshotsRelations = relations(
	composeDeploymentSnapshots,
	({ one }) => ({
		compose: one(compose, {
			fields: [composeDeploymentSnapshots.composeId],
			references: [compose.composeId],
		}),
		deployment: one(deployments, {
			fields: [composeDeploymentSnapshots.deploymentId],
			references: [deployments.deploymentId],
		}),
	}),
);

export const insertComposeDeploymentSnapshotSchema = createInsertSchema(composeDeploymentSnapshots);
export const selectComposeDeploymentSnapshotSchema = createSelectSchema(composeDeploymentSnapshots);
export type ComposeDeploymentSnapshot = typeof composeDeploymentSnapshots.$inferSelect;
