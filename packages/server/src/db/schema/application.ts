import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { applicationSourceType, buildType, serviceStatus } from "./enums";
import { bitbucket, gitea, github, gitlab } from "./git-provider";
import { environments } from "./project";
import { registry } from "./registry";
import { servers, sshKeys } from "./server";
import { createdAt, idColumn } from "./utils";

export const applications = pgTable(
	"application",
	{
		applicationId: idColumn("application_id"),
		name: text("name").notNull(),
		/** Unique, dns-safe identifier used for swarm service/traefik naming. */
		appName: text("app_name").notNull().unique(),
		description: text("description"),
		/** Service-level env vars (encrypted at rest), override project/environment. */
		env: encryptedText("env"),
		buildArgs: encryptedText("build_args"),
		status: serviceStatus("status").notNull().default("idle"),

		// ── resources / replicas ────────────────────────────────────────────────
		memoryReservation: text("memory_reservation"),
		memoryLimit: text("memory_limit"),
		cpuReservation: text("cpu_reservation"),
		cpuLimit: text("cpu_limit"),
		replicas: integer("replicas").notNull().default(1),
		/** Override container start command. */
		command: text("command"),

		// ── source ──────────────────────────────────────────────────────────────
		sourceType: applicationSourceType("source_type").notNull().default("github"),
		// git-ish sources
		repository: text("repository"),
		owner: text("owner"),
		branch: text("branch"),
		buildPath: text("build_path").notNull().default("/"),
		autoDeploy: boolean("auto_deploy").notNull().default(true),
		/** When true, pull_request webhooks create/redeploy/delete preview deployments. */
		isPreviewDeploymentsActive: boolean("is_preview_deployments_active").notNull().default(false),
		watchPaths: text("watch_paths").array(),
		// docker source
		dockerImage: text("docker_image"),
		username: text("username"),
		password: encryptedText("password"),
		registryId: text("registry_id").references(() => registry.registryId, {
			onDelete: "set null",
		}),
		// generic git source
		gitUrl: text("git_url"),
		gitBranch: text("git_branch"),
		customGitSSHKeyId: text("custom_git_ssh_key_id").references(() => sshKeys.sshKeyId, {
			onDelete: "set null",
		}),
		// provider connections
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

		// ── build ───────────────────────────────────────────────────────────────
		buildType: buildType("build_type").notNull().default("nixpacks"),
		dockerfile: text("dockerfile"),
		dockerContextPath: text("docker_context_path"),
		dockerBuildStage: text("docker_build_stage"),
		/** When true, BuildKit local cache-from/cache-to is used for dockerfile/nixpacks/railpack. */
		useBuildCache: boolean("use_build_cache").notNull().default(true),
		/** static build type: directory served by nginx. */
		publishDirectory: text("publish_directory"),
		isStaticSpa: boolean("is_static_spa"),

		// ── swarm tuning (raw dockerode ServiceSpec fragments) ──────────────────
		healthCheckSwarm: jsonb("health_check_swarm"),
		restartPolicySwarm: jsonb("restart_policy_swarm"),
		placementSwarm: jsonb("placement_swarm"),
		updateConfigSwarm: jsonb("update_config_swarm"),
		rollbackConfigSwarm: jsonb("rollback_config_swarm"),
		modeSwarm: jsonb("mode_swarm"),
		labelsSwarm: jsonb("labels_swarm"),
		networkSwarm: jsonb("network_swarm"),

		// ── tenancy / placement ─────────────────────────────────────────────────
		environmentId: text("environment_id")
			.notNull()
			.references(() => environments.environmentId, { onDelete: "cascade" }),
		/** null = run on the Nixploy host itself. */
		serverId: text("server_id").references(() => servers.serverId, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
	},
	(table) => [index("application_environment_id_idx").on(table.environmentId)],
);

export const applicationsRelations = relations(applications, ({ one }) => ({
	environment: one(environments, {
		fields: [applications.environmentId],
		references: [environments.environmentId],
	}),
	server: one(servers, {
		fields: [applications.serverId],
		references: [servers.serverId],
	}),
	registry: one(registry, {
		fields: [applications.registryId],
		references: [registry.registryId],
	}),
	github: one(github, {
		fields: [applications.githubId],
		references: [github.githubId],
	}),
	gitlab: one(gitlab, {
		fields: [applications.gitlabId],
		references: [gitlab.gitlabId],
	}),
	bitbucket: one(bitbucket, {
		fields: [applications.bitbucketId],
		references: [bitbucket.bitbucketId],
	}),
	gitea: one(gitea, {
		fields: [applications.giteaId],
		references: [gitea.giteaId],
	}),
	customGitSSHKey: one(sshKeys, {
		fields: [applications.customGitSSHKeyId],
		references: [sshKeys.sshKeyId],
	}),
}));

export const insertApplicationSchema = createInsertSchema(applications);
export const selectApplicationSchema = createSelectSchema(applications);
