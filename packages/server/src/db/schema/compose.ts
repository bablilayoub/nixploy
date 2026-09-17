import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { composeSourceType, composeType, serviceStatus } from "./enums";
import { bitbucket, gitea, github, gitlab } from "./git-provider";
import { environments } from "./project";
import { servers, sshKeys } from "./server";
import { createdAt, idColumn } from "./utils";

export const compose = pgTable(
	"compose",
	{
		composeId: idColumn("compose_id"),
		name: text("name").notNull(),
		appName: text("app_name").notNull().unique(),
		description: text("description"),
		env: encryptedText("env"),
		status: serviceStatus("status").notNull().default("idle"),
		composeType: composeType("compose_type").notNull().default("docker-compose"),

		/** Raw pasted compose file when sourceType = raw; otherwise read from repo. */
		composeFile: text("compose_file").notNull().default(""),

		// ── source ──────────────────────────────────────────────────────────────
		sourceType: composeSourceType("source_type").notNull().default("raw"),
		repository: text("repository"),
		owner: text("owner"),
		branch: text("branch"),
		composePath: text("compose_path").notNull().default("./docker-compose.yml"),
		autoDeploy: boolean("auto_deploy").notNull().default(true),
		watchPaths: text("watch_paths").array(),

		// ── build from source ───────────────────────────────────────────────────
		/**
		 * Allow `build:` blocks in the compose file. Off by default: Nixploy
		 * builds those images itself and rewrites them to `image:` before the
		 * file reaches docker (see `modules/compose/build.ts`), so a stack that
		 * has not opted in is still refused at safety-check time.
		 */
		buildEnabled: boolean("build_enabled").notNull().default(false),
		/** `KEY=VALUE` build args shared by every build service of the stack. */
		buildArgs: encryptedText("build_args"),

		/**
		 * Allow the stack to publish host ports. Off by default: a stack that
		 * binds :80/:443 fights Traefik for the port and routes around domains,
		 * TLS and middlewares entirely. Opting in still cannot take a
		 * privileged, well-known-database or platform-owned port.
		 */
		publishPorts: boolean("publish_ports").notNull().default(false),

		// ── previews ────────────────────────────────────────────────────────────
		// Same names and semantics as the application columns (see
		// `schema/application.ts`); `modules/preview` reads both through one
		// `PreviewParent` shape, so the two sets must not drift.
		/** When true, pull_request webhooks create/redeploy/delete preview stacks. */
		isPreviewDeploymentsActive: boolean("is_preview_deployments_active").notNull().default(false),
		/** Safe default: fork PRs wait for an org member's approval before deploying. */
		previewForksRequireApproval: boolean("preview_forks_require_approval").notNull().default(true),
		/** Preview-only env, merged OVER the service env layer for PR renders. */
		previewEnv: encryptedText("preview_env"),
		/** Max simultaneous previews for this stack; a webhook over the cap is refused. */
		previewLimit: integer("preview_limit").notNull().default(3),
		/** Default expiry handed to webhook-created previews (null = never expire). */
		previewTtlHours: integer("preview_ttl_hours"),

		gitUrl: text("git_url"),
		gitBranch: text("git_branch"),
		customGitSSHKeyId: text("custom_git_ssh_key_id").references(() => sshKeys.sshKeyId, {
			onDelete: "set null",
		}),
		githubId: text("github_id").references(() => github.githubId, {
			onDelete: "set null",
		}),
		gitlabId: text("gitlab_id").references(() => gitlab.gitlabId, {
			onDelete: "set null",
		}),
		bitbucketId: text("bitbucket_id").references(() => bitbucket.bitbucketId, {
			onDelete: "set null",
		}),
		giteaId: text("gitea_id").references(() => gitea.giteaId, {
			onDelete: "set null",
		}),

		// ── deploy hooks ────────────────────────────────────────────────────────
		/**
		 * Shell command run in a throwaway container BEFORE `docker compose up` /
		 * `stack deploy`. A non-zero exit aborts the deployment and the running
		 * project is left untouched.
		 */
		preDeployCommand: text("pre_deploy_command"),
		/** Shell command run inside one running project container afterwards. */
		postDeployCommand: text("post_deploy_command"),

		/** Randomize service/container names to avoid collisions between copies. */
		isolatedDeployment: boolean("isolated_deployment").notNull().default(false),
		suffix: text("suffix").notNull().default(""),

		/**
		 * Instance-admin-only templates (Docker socket / elevated caps). When set,
		 * compose safety allows a narrow allowlist; never settable via public APIs.
		 */
		hostPrivileged: boolean("host_privileged").notNull().default(false),

		environmentId: text("environment_id")
			.notNull()
			.references(() => environments.environmentId, { onDelete: "cascade" }),
		serverId: text("server_id").references(() => servers.serverId, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
	},
	(table) => [index("compose_environment_id_idx").on(table.environmentId)],
);

export const composeRelations = relations(compose, ({ one }) => ({
	environment: one(environments, {
		fields: [compose.environmentId],
		references: [environments.environmentId],
	}),
	server: one(servers, {
		fields: [compose.serverId],
		references: [servers.serverId],
	}),
	github: one(github, {
		fields: [compose.githubId],
		references: [github.githubId],
	}),
	gitlab: one(gitlab, {
		fields: [compose.gitlabId],
		references: [gitlab.gitlabId],
	}),
	bitbucket: one(bitbucket, {
		fields: [compose.bitbucketId],
		references: [bitbucket.bitbucketId],
	}),
	gitea: one(gitea, {
		fields: [compose.giteaId],
		references: [gitea.giteaId],
	}),
	customGitSSHKey: one(sshKeys, {
		fields: [compose.customGitSSHKeyId],
		references: [sshKeys.sshKeyId],
	}),
}));

export const insertComposeSchema = createInsertSchema(compose);
export const selectComposeSchema = createSelectSchema(compose);
