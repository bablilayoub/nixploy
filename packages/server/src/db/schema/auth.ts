import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./utils";

// ── better-auth core tables ─────────────────────────────────────────────────

export const users = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
	// admin plugin
	role: text("role"),
	banned: boolean("banned"),
	banReason: text("ban_reason"),
	banExpires: timestamp("ban_expires", { withTimezone: true }),
	// twoFactor plugin
	twoFactorEnabled: boolean("two_factor_enabled"),
});

export const sessions = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	token: text("token").notNull().unique(),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	// admin plugin
	impersonatedBy: text("impersonated_by"),
	// organization plugin
	activeOrganizationId: text("active_organization_id"),
});

export const accounts = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", {
		withTimezone: true,
	}),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
		withTimezone: true,
	}),
	scope: text("scope"),
	password: text("password"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export const verifications = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

// ── organization plugin ─────────────────────────────────────────────────────

export const organizations = pgTable("organization", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	logo: text("logo"),
	metadata: text("metadata"),
	createdAt: createdAt(),
});

export const members = pgTable(
	"member",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		/** Optional grant/revoke overlays on top of the role's default capabilities. */
		capabilityOverrides: jsonb("capability_overrides").$type<{
			grant?: string[];
			revoke?: string[];
		}>(),
		createdAt: createdAt(),
	},
	(table) => [index("member_user_org_idx").on(table.userId, table.organizationId)],
);

export const invitations = pgTable("invitation", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	email: text("email").notNull(),
	role: text("role"),
	status: text("status").notNull().default("pending"),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	inviterId: text("inviter_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	createdAt: createdAt(),
});

// ── apiKey plugin ───────────────────────────────────────────────────────────

export const apikeys = pgTable("apikey", {
	id: text("id").primaryKey(),
	configId: text("config_id").notNull().default("default"),
	name: text("name"),
	start: text("start"),
	prefix: text("prefix"),
	key: text("key").notNull(),
	referenceId: text("reference_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	refillInterval: integer("refill_interval"),
	refillAmount: integer("refill_amount"),
	lastRefillAt: timestamp("last_refill_at", { withTimezone: true }),
	enabled: boolean("enabled").notNull().default(true),
	rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(false),
	rateLimitTimeWindow: integer("rate_limit_time_window"),
	rateLimitMax: integer("rate_limit_max"),
	requestCount: integer("request_count").notNull().default(0),
	remaining: integer("remaining"),
	lastRequest: timestamp("last_request", { withTimezone: true }),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
	permissions: text("permissions"),
	metadata: text("metadata"),
});

// ── twoFactor plugin ────────────────────────────────────────────────────────

export const twoFactors = pgTable("two_factor", {
	id: text("id").primaryKey(),
	secret: text("secret").notNull(),
	backupCodes: text("backup_codes").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	verified: boolean("verified").notNull().default(false),
	failedVerificationCount: integer("failed_verification_count").notNull().default(0),
	lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

// ── relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many, one }) => ({
	sessions: many(sessions),
	accounts: many(accounts),
	members: many(members),
	invitations: many(invitations),
	apikeys: many(apikeys),
	twoFactor: one(twoFactors, {
		fields: [users.id],
		references: [twoFactors.userId],
	}),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id],
	}),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id],
	}),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
	members: many(members),
	invitations: many(invitations),
}));

export const membersRelations = relations(members, ({ one }) => ({
	organization: one(organizations, {
		fields: [members.organizationId],
		references: [organizations.id],
	}),
	user: one(users, {
		fields: [members.userId],
		references: [users.id],
	}),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
	organization: one(organizations, {
		fields: [invitations.organizationId],
		references: [organizations.id],
	}),
	inviter: one(users, {
		fields: [invitations.inviterId],
		references: [users.id],
	}),
}));

export const apikeysRelations = relations(apikeys, ({ one }) => ({
	user: one(users, {
		fields: [apikeys.referenceId],
		references: [users.id],
	}),
}));

export const twoFactorsRelations = relations(twoFactors, ({ one }) => ({
	user: one(users, {
		fields: [twoFactors.userId],
		references: [users.id],
	}),
}));
