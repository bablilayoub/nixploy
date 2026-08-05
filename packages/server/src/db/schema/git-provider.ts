import { relations } from "drizzle-orm";
import { bigint, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { organizations } from "./auth";
import { gitProviderType } from "./enums";
import { createdAt, idColumn } from "./utils";

/** Base row grouping the provider-specific configs below. */
export const gitProviders = pgTable("git_provider", {
	gitProviderId: idColumn("git_provider_id"),
	name: text("name").notNull(),
	providerType: gitProviderType("provider_type").notNull(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	createdAt: createdAt(),
});

/** GitHub App credentials (octokit). */
export const github = pgTable("github", {
	githubId: idColumn("github_id"),
	gitProviderId: text("git_provider_id")
		.notNull()
		.references(() => gitProviders.gitProviderId, { onDelete: "cascade" }),
	githubAppId: bigint("github_app_id", { mode: "number" }),
	githubAppName: text("github_app_name"),
	githubClientId: text("github_client_id"),
	githubClientSecret: encryptedText("github_client_secret"),
	githubPrivateKey: encryptedText("github_private_key"),
	githubWebhookSecret: encryptedText("github_webhook_secret"),
	githubInstallationId: text("github_installation_id"),
	createdAt: createdAt(),
});

/** GitLab OAuth application + PAT. */
export const gitlab = pgTable("gitlab", {
	gitlabId: idColumn("gitlab_id"),
	gitProviderId: text("git_provider_id")
		.notNull()
		.references(() => gitProviders.gitProviderId, { onDelete: "cascade" }),
	gitlabUrl: text("gitlab_url").notNull().default("https://gitlab.com"),
	applicationId: text("application_id"),
	secret: encryptedText("secret"),
	accessToken: encryptedText("access_token"),
	refreshToken: encryptedText("refresh_token"),
	redirectUri: text("redirect_uri"),
	groupName: text("group_name"),
	expiresAt: integer("expires_at"),
	createdAt: createdAt(),
});

export const bitbucket = pgTable("bitbucket", {
	bitbucketId: idColumn("bitbucket_id"),
	gitProviderId: text("git_provider_id")
		.notNull()
		.references(() => gitProviders.gitProviderId, { onDelete: "cascade" }),
	bitbucketUsername: text("bitbucket_username"),
	bitbucketWorkspaceName: text("bitbucket_workspace_name"),
	appPassword: encryptedText("app_password"),
	apiToken: encryptedText("api_token"),
	createdAt: createdAt(),
});

export const gitea = pgTable("gitea", {
	giteaId: idColumn("gitea_id"),
	gitProviderId: text("git_provider_id")
		.notNull()
		.references(() => gitProviders.gitProviderId, { onDelete: "cascade" }),
	giteaUrl: text("gitea_url").notNull().default("https://gitea.com"),
	accessToken: encryptedText("access_token"),
	redirectUri: text("redirect_uri"),
	expiresAt: integer("expires_at"),
	refreshToken: encryptedText("refresh_token"),
	lastSyncedAt: integer("last_synced_at"),
	createdAt: createdAt(),
});

export const gitProvidersRelations = relations(gitProviders, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [gitProviders.organizationId],
		references: [organizations.id],
	}),
	github: many(github),
	gitlab: many(gitlab),
	bitbucket: many(bitbucket),
	gitea: many(gitea),
}));

export const githubRelations = relations(github, ({ one }) => ({
	gitProvider: one(gitProviders, {
		fields: [github.gitProviderId],
		references: [gitProviders.gitProviderId],
	}),
}));

export const gitlabRelations = relations(gitlab, ({ one }) => ({
	gitProvider: one(gitProviders, {
		fields: [gitlab.gitProviderId],
		references: [gitProviders.gitProviderId],
	}),
}));

export const bitbucketRelations = relations(bitbucket, ({ one }) => ({
	gitProvider: one(gitProviders, {
		fields: [bitbucket.gitProviderId],
		references: [gitProviders.gitProviderId],
	}),
}));

export const giteaRelations = relations(gitea, ({ one }) => ({
	gitProvider: one(gitProviders, {
		fields: [gitea.gitProviderId],
		references: [gitProviders.gitProviderId],
	}),
}));

export const insertGitProviderSchema = createInsertSchema(gitProviders);
export const selectGitProviderSchema = createSelectSchema(gitProviders);
export const insertGithubSchema = createInsertSchema(github);
export const selectGithubSchema = createSelectSchema(github);
export const insertGitlabSchema = createInsertSchema(gitlab);
export const selectGitlabSchema = createSelectSchema(gitlab);
export const insertBitbucketSchema = createInsertSchema(bitbucket);
export const selectBitbucketSchema = createSelectSchema(bitbucket);
export const insertGiteaSchema = createInsertSchema(gitea);
export const selectGiteaSchema = createSelectSchema(gitea);
