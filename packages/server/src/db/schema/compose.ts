import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text } from "drizzle-orm/pg-core";
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
