import { index, pgTable, text } from "drizzle-orm/pg-core";
import { encryptedText } from "../custom-columns";
import { organizations } from "./auth";
import { deployments } from "./deployment";
import { createdAt, updatedAt } from "./utils";

/** Organization variables must never travel through better-auth metadata. */
export const organizationEnvironments = pgTable("organization_environment", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organizations.id, { onDelete: "cascade" }),
	env: encryptedText("env").notNull(),
	updatedAt: updatedAt(),
});

/** Immutable inputs captured in the same transaction that queues a deployment. */
export const deploymentEnvironmentSnapshots = pgTable(
	"deployment_environment_snapshot",
	{
		deploymentId: text("deployment_id")
			.primaryKey()
			.references(() => deployments.deploymentId, { onDelete: "cascade" }),
		runtimeEnv: encryptedText("runtime_env").notNull(),
		serviceEnv: encryptedText("service_env").notNull(),
		buildArgs: encryptedText("build_args"),
		/** Purpose-separated HMAC, never an unkeyed digest of secret values. */
		sourceFingerprint: text("source_fingerprint").notNull(),
		releaseId: text("release_id"),
		createdAt: createdAt(),
	},
	(table) => [index("deployment_environment_release_idx").on(table.releaseId)],
);
