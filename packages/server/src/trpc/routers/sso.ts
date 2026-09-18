import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { organizations, ssoProviders } from "../../db/schema";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { checkSsoLockoutForOrganization, hasLinkedSsoAccount } from "../../modules/auth/sso-gate";
import { publishAuthRebuild } from "../../modules/auth/sso-notify";
import {
	isSsoPreset,
	SSO_PRESET_INFO,
	SSO_PRESETS,
	ssoRedirectUri,
} from "../../modules/auth/sso-presets";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { ORG_ROLE_RANK } from "../../modules/projects/roles";
import { assertPublicHttpsUrl } from "../../utils/public-url";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

/**
 * Identity providers are instance-wide — they appear on the login page for
 * everyone — so managing them is instance admin only, like every other shared
 * piece of infrastructure.
 */
async function requireInstanceAdmin(session: Session): Promise<string> {
	await assertInstanceAdmin(session);
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/**
 * A provider slug is part of the redirect URI registered at the IdP, so it is
 * restricted to what is safe in a path segment — and cannot be changed later.
 */
const providerIdSchema = z
	.string()
	.min(2)
	.max(40)
	.regex(
		/^[a-z][a-z0-9-]*$/,
		"Use lowercase letters, digits and dashes — the id appears in the redirect URI",
	);

const roleSchema = z.enum(Object.keys(ORG_ROLE_RANK) as [string, ...string[]]);

const providerFields = {
	name: z.string().min(1).max(80),
	preset: z.enum(SSO_PRESETS),
	issuer: z.string().url().max(500).nullish(),
	authorizationUrl: z.string().url().max(500).nullish(),
	tokenUrl: z.string().url().max(500).nullish(),
	userInfoUrl: z.string().url().max(500).nullish(),
	clientId: z.string().min(1).max(500),
	scopes: z.array(z.string().min(1).max(60)).min(1).max(20),
	allowedEmailDomains: z.array(z.string().min(1).max(253)).max(50),
	defaultOrganizationId: z.string().min(1).nullish(),
	defaultRole: roleSchema,
	groupClaim: z.string().min(1).max(200).nullish(),
	groupMappings: z.record(z.string().min(1).max(200), roleSchema),
	syncRoleOnLogin: z.boolean(),
	enabled: z.boolean(),
};

/**
 * Every URL an operator types here is fetched by the panel (discovery, token
 * exchange), so each one goes through the egress guard: an issuer pointing at
 * the Swarm overlay or a cloud metadata endpoint would turn the login page
 * into an SSRF primitive.
 */
async function assertProviderUrls(input: {
	issuer?: string | null;
	authorizationUrl?: string | null;
	tokenUrl?: string | null;
	userInfoUrl?: string | null;
}): Promise<void> {
	for (const url of [input.issuer, input.authorizationUrl, input.tokenUrl, input.userInfoUrl]) {
		if (!url) continue;
		await assertPublicHttpsUrl(url);
	}
}

/** A provider needs either a discoverable issuer or a full set of endpoints. */
function assertEndpointsResolvable(input: {
	preset: string;
	issuer?: string | null;
	authorizationUrl?: string | null;
	tokenUrl?: string | null;
}): void {
	const preset = isSsoPreset(input.preset) ? input.preset : "custom";
	if (SSO_PRESET_INFO[preset].endpoints) return; // preset carries them
	if (input.issuer) return; // discovery will supply them
	if (input.authorizationUrl && input.tokenUrl) return;
	throw new TRPCError({
		code: "BAD_REQUEST",
		message:
			"Give an issuer URL (its discovery document supplies the endpoints), or fill in the authorization and token URLs by hand.",
	});
}

/** The row, minus the client secret. Never widen this. */
const publicProvider = (row: typeof ssoProviders.$inferSelect) => {
	const { clientSecret: _clientSecret, ...rest } = row;
	return { ...rest, hasClientSecret: true };
};

export const ssoRouter = router({
	/** Presets and their hints, for the provider form. */
	presets: protectedProcedure.query(async ({ ctx }) => {
		await requireInstanceAdmin(ctx.session);
		return SSO_PRESETS.map((preset) => ({ preset, ...SSO_PRESET_INFO[preset] }));
	}),

	/** Every configured provider, secrets excluded. */
	all: protectedProcedure.query(async ({ ctx }) => {
		await requireInstanceAdmin(ctx.session);
		const rows = await db.query.ssoProviders.findMany({
			orderBy: (provider, { asc }) => asc(provider.createdAt),
		});
		return rows.map(publicProvider);
	}),

	/**
	 * The redirect URI to register at the IdP, for a slug the operator is about
	 * to use. Resolved server-side from the configured base URL so the form does
	 * not have to guess at the panel's public origin.
	 */
	redirectUri: protectedProcedure
		.input(z.object({ providerId: providerIdSchema }))
		.query(async ({ ctx, input }) => {
			await requireInstanceAdmin(ctx.session);
			const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.NIXPLOY_BASE_URL ?? "";
			return { redirectUri: ssoRedirectUri(baseUrl, input.providerId), baseUrl };
		}),

	create: protectedProcedure
		.input(
			z.object({
				providerId: providerIdSchema,
				clientSecret: z.string().min(1).max(2000),
				...providerFields,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireInstanceAdmin(ctx.session);
			await assertProviderUrls(input);
			assertEndpointsResolvable(input);

			const existing = await db.query.ssoProviders.findFirst({
				where: eq(ssoProviders.providerId, input.providerId),
			});
			if (existing) {
				throw new TRPCError({
					code: "CONFLICT",
					message: `A provider with the id "${input.providerId}" already exists`,
				});
			}

			const [row] = await db
				.insert(ssoProviders)
				.values({
					providerId: input.providerId,
					preset: input.preset,
					name: input.name,
					issuer: input.issuer ?? null,
					authorizationUrl: input.authorizationUrl ?? null,
					tokenUrl: input.tokenUrl ?? null,
					userInfoUrl: input.userInfoUrl ?? null,
					clientId: input.clientId,
					clientSecret: input.clientSecret,
					scopes: input.scopes,
					allowedEmailDomains: input.allowedEmailDomains,
					defaultOrganizationId: input.defaultOrganizationId ?? null,
					defaultRole: input.defaultRole,
					groupClaim: input.groupClaim ?? null,
					groupMappings: input.groupMappings,
					syncRoleOnLogin: input.syncRoleOnLogin,
					enabled: input.enabled,
				})
				.returning();
			if (!row) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not save provider" });
			}
			// The plugin array is frozen at construction: without this the provider
			// exists in the database and the login page still cannot use it.
			await publishAuthRebuild();
			void auditFromSession(ctx, organizationId, {
				action: "sso.create",
				targetType: "ssoProvider",
				targetId: row.ssoProviderId,
				targetName: row.providerId,
				metadata: { preset: row.preset, enabled: row.enabled },
			});
			return publicProvider(row);
		}),

	update: protectedProcedure
		.input(
			z.object({
				ssoProviderId: z.string().min(1),
				/** Omit to keep the stored secret; the panel never reads it back. */
				clientSecret: z.string().min(1).max(2000).optional(),
				...providerFields,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireInstanceAdmin(ctx.session);
			await assertProviderUrls(input);
			assertEndpointsResolvable(input);

			const existing = await db.query.ssoProviders.findFirst({
				where: eq(ssoProviders.ssoProviderId, input.ssoProviderId),
			});
			if (!existing) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
			}

			const { ssoProviderId, clientSecret, ...fields } = input;
			const [row] = await db
				.update(ssoProviders)
				.set({
					...fields,
					issuer: input.issuer ?? null,
					authorizationUrl: input.authorizationUrl ?? null,
					tokenUrl: input.tokenUrl ?? null,
					userInfoUrl: input.userInfoUrl ?? null,
					defaultOrganizationId: input.defaultOrganizationId ?? null,
					groupClaim: input.groupClaim ?? null,
					...(clientSecret ? { clientSecret } : {}),
					updatedAt: new Date(),
				})
				.where(eq(ssoProviders.ssoProviderId, ssoProviderId))
				.returning();
			if (!row) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not save provider" });
			}
			await publishAuthRebuild();
			void auditFromSession(ctx, organizationId, {
				action: "sso.update",
				targetType: "ssoProvider",
				targetId: row.ssoProviderId,
				targetName: row.providerId,
				metadata: {
					preset: row.preset,
					enabled: row.enabled,
					secretRotated: Boolean(clientSecret),
				},
			});
			return publicProvider(row);
		}),

	delete: protectedProcedure
		.input(z.object({ ssoProviderId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireInstanceAdmin(ctx.session);
			const existing = await db.query.ssoProviders.findFirst({
				where: eq(ssoProviders.ssoProviderId, input.ssoProviderId),
			});
			if (!existing) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
			}
			// Removing the last provider while an organization still requires SSO
			// would lock every non-instance-admin member out of it.
			const stillRequired = await db.query.organizations.findFirst({
				where: eq(organizations.requireSso, true),
				columns: { name: true },
			});
			const remaining = (await db.query.ssoProviders.findMany({ columns: { ssoProviderId: true } }))
				.length;
			if (stillRequired && remaining <= 1) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: `"${stillRequired.name}" still requires single sign-on — turn that off before removing the last provider, or its members cannot sign in.`,
				});
			}

			await db.delete(ssoProviders).where(eq(ssoProviders.ssoProviderId, input.ssoProviderId));
			await publishAuthRebuild();
			void auditFromSession(ctx, organizationId, {
				action: "sso.delete",
				targetType: "ssoProvider",
				targetId: existing.ssoProviderId,
				targetName: existing.providerId,
			});
			return { ssoProviderId: input.ssoProviderId };
		}),

	/* ---------------------------------------------------------------------- */
	/*  Per-organization enforcement                                          */
	/* ---------------------------------------------------------------------- */

	/**
	 * Whether this organization requires SSO, and whether it *could* — the
	 * panel disables the switch and shows the reason rather than letting
	 * someone discover the lockout guard by hitting it.
	 */
	requirement: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		const organization = await db.query.organizations.findFirst({
			where: eq(organizations.id, organizationId),
			columns: { requireSso: true },
		});
		return {
			requireSso: organization?.requireSso ?? false,
			lockout: await checkSsoLockoutForOrganization(organizationId),
			callerHasSsoAccount: await hasLinkedSsoAccount(ctx.session.user.id),
		};
	}),

	setRequirement: protectedProcedure
		.input(z.object({ requireSso: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "settings.manage");

			// Turning it ON is the dangerous direction and the only one guarded:
			// turning it off can never lock anybody out.
			if (input.requireSso) {
				const check = await checkSsoLockoutForOrganization(organizationId);
				if (!check.allowed) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: check.reason ?? "Requiring SSO would lock this organization out",
					});
				}
			}

			await db
				.update(organizations)
				.set({ requireSso: input.requireSso })
				.where(eq(organizations.id, organizationId));
			void auditFromSession(ctx, organizationId, {
				action: "sso.setRequirement",
				targetType: "organization",
				targetId: organizationId,
				metadata: { requireSso: input.requireSso },
			});
			return { requireSso: input.requireSso };
		}),
});
