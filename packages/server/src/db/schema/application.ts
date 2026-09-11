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
		/** Safe default: fork PRs wait for an org member's approval before building. */
		previewForksRequireApproval: boolean("preview_forks_require_approval").notNull().default(true),
		/** Preview-only env, merged OVER the inherited runtime env for PR builds. */
		previewEnv: encryptedText("preview_env"),
		/** Max simultaneous previews for this app; a webhook over the cap is refused. */
		previewLimit: integer("preview_limit").notNull().default(3),
		/** Default expiry handed to webhook-created previews (null = never expire). */
		previewTtlHours: integer("preview_ttl_hours"),
		watchPaths: text("watch_paths").array(),
		// docker source
		dockerImage: text("docker_image"),
		/** Poll the registry hourly and redeploy when the tag's digest moved. */
		autoUpdateImage: boolean("auto_update_image").notNull().default(false),
		username: text("username"),
		password: encryptedText("password"),
		registryId: text("registry_id").references(() => registry.registryId, {
			onDelete: "set null",
		}),
		/**
		 * Optional push target for BUILT images (`registryId` is the pull side).
		 * When set the deploy tags the build `<imagePrefix>/<appName>:<version>`,
		 * pushes it and runs the swarm service from that reference, so a task
		 * scheduled on another node can pull it.
		 */
		pushRegistryId: text("push_registry_id").references(() => registry.registryId, {
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

		// ── deploy hooks ────────────────────────────────────────────────────────
		/**
		 * Shell command run in a throwaway container from the freshly built
		 * image BEFORE the rollout (migrations). A non-zero exit aborts the
		 * deployment and the previous version keeps serving.
		 */
		preDeployCommand: text("pre_deploy_command"),
		/** Shell command run inside one running task AFTER the rollout converged. */
		postDeployCommand: text("post_deploy_command"),

		// ── swarm tuning (raw dockerode ServiceSpec fragments) ──────────────────
		healthCheckSwarm: jsonb("health_check_swarm"),
		restartPolicySwarm: jsonb("restart_policy_swarm"),
		placementSwarm: jsonb("placement_swarm"),
		updateConfigSwarm: jsonb("update_config_swarm"),
		rollbackConfigSwarm: jsonb("rollback_config_swarm"),
		modeSwarm: jsonb("mode_swarm"),
		labelsSwarm: jsonb("labels_swarm"),
		networkSwarm: jsonb("network_swarm"),
		/** Instance-admin-only relaxation of the container hardening (utils/swarm-overrides). */
		privilegesSwarm: jsonb("privileges_swarm"),

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
