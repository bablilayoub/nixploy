import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testUrl = process.env.DATABASE_URL_TEST;
const setupToken = "test-only-first-admin-claim";
const password = "Test-only-admin-password-123!";

interface AuthPayload {
	id?: string;
	url?: string;
	user?: { id: string; role?: string };
}

/**
 * Real HTTP + Better Auth + Postgres. This suite owns a separate database:
 * clearing first-boot state must never erase the shared tenancy fixtures.
 */
describe.skipIf(!testUrl)("first-admin setup (postgres)", () => {
	const databaseName = `nixploy_setup_${randomUUID().replaceAll("-", "")}`;
	let adminSql: ReturnType<typeof postgres>;
	let privateSql: ReturnType<typeof postgres>;
	let server: Server;
	let origin: string;
	let auth: typeof import("./auth").auth;
	let rebuildAuth: typeof import("./auth").rebuildAuth;
	let clientNumber = 0;

	beforeAll(async () => {
		adminSql = postgres(testUrl as string, { max: 1, prepare: false, onnotice: () => {} });
		await adminSql`CREATE DATABASE ${adminSql(databaseName)}`;
		const url = new URL(testUrl as string);
		url.pathname = `/${databaseName}`;
		privateSql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
		await migrate(drizzle(privateSql), { migrationsFolder: "./drizzle" });
		server = createServer(async (request, response) => {
			try {
				const chunks: Buffer[] = [];
				for await (const chunk of request) chunks.push(Buffer.from(chunk));
				const headers = new Headers();
				for (const [name, value] of Object.entries(request.headers)) {
					if (Array.isArray(value)) {
						for (const item of value) headers.append(name, item);
					} else if (value !== undefined) headers.set(name, value);
				}
				const result = await auth.handler(
					new Request(`${origin}${request.url}`, {
						method: request.method,
						headers,
						...(chunks.length ? { body: Buffer.concat(chunks).toString("utf8") } : {}),
					}),
				);
				response.statusCode = result.status;
				for (const [name, value] of result.headers) {
					if (name !== "set-cookie") response.setHeader(name, value);
				}
				response.setHeader("set-cookie", result.headers.getSetCookie());
				response.end(await result.text());
			} catch {
				response.statusCode = 500;
				response.end("HTTP test handler failed");
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Test server has no port");
		origin = `http://127.0.0.1:${address.port}`;
		vi.stubEnv("DATABASE_URL", url.toString());
		// A second connection in a hook would deadlock this pool.
		vi.stubEnv("DATABASE_POOL_MAX", "1");
		vi.stubEnv("BETTER_AUTH_URL", origin);
		vi.stubEnv("BETTER_AUTH_SECRET", "test-only-atomic-setup-secret-1234567890");
		vi.stubEnv("NIXPLOY_SETUP_TOKEN", setupToken);
		// This local bridge acts as the reverse proxy. Each request represents
		// a different client so the real signup limiter does not mask admission.
		vi.stubEnv("TRUSTED_PROXIES", "1");
		({ auth, rebuildAuth } = await import("./auth"));
	}, 60_000);

	beforeEach(async () => {
		await privateSql.unsafe('DROP TRIGGER IF EXISTS reject_setup_write ON "account"');
		await privateSql.unsafe('DROP TRIGGER IF EXISTS reject_setup_write ON "session"');
		await privateSql.unsafe('DROP TRIGGER IF EXISTS reject_setup_write ON "organization"');
		await privateSql.unsafe('TRUNCATE "user", "organization" CASCADE');
		const { invalidateSsoProviderCache } = await import("../modules/auth/sso");
		invalidateSsoProviderCache();
		await rebuildAuth();
	});

	afterAll(async () => {
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
		if (auth) {
			const { client } = await import("../db");
			await client.end({ timeout: 1 });
		}
		if (privateSql) await privateSql.end({ timeout: 1 });
		if (adminSql) {
			await adminSql`DROP DATABASE IF EXISTS ${adminSql(databaseName)}`;
			await adminSql.end({ timeout: 1 });
		}
		vi.unstubAllEnvs();
	});

	async function post(
		path: string,
		body: Record<string, unknown>,
		cookie = "",
		headers: Record<string, string> = {},
	) {
		const response = await fetch(`${origin}/api/auth${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": `198.51.100.${++clientNumber}`,
				origin,
				cookie,
				...headers,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
		const text = await response.text();
		return {
			status: response.status,
			data: (text ? JSON.parse(text) : {}) as AuthPayload,
			cookie: response.headers
				.getSetCookie()
				.map((value) => value.split(";")[0])
				.join("; "),
		};
	}

	const signup = (email: string, headers: Record<string, string> = {}) =>
		post("/sign-up/email", { name: "Operator", email, password }, "", {
			"x-nixploy-setup-token": setupToken,
			...headers,
		});

	it("commits one first admin under concurrent HTTP signup with a one-connection pool", async () => {
		const attempts = await Promise.all([0, 1, 2].map((id) => signup(`operator-${id}@example.com`)));
		expect(attempts.map((result) => result.status).sort()).toEqual([200, 403, 403]);
		expect(attempts.find((result) => result.status === 200)?.data.user?.role).toBe("admin");
		expect(await privateSql`SELECT role FROM "user"`).toEqual([{ role: "admin" }]);
		expect(await privateSql`SELECT count(*)::int AS count FROM "account"`).toEqual([{ count: 1 }]);
		expect(await privateSql`SELECT count(*)::int AS count FROM "session"`).toEqual([{ count: 1 }]);
	}, 20_000);

	it("does not claim setup with a missing or wrong installer token", async () => {
		for (const token of ["", "wrong-token"]) {
			expect((await signup("owner@example.com", { "x-nixploy-setup-token": token })).status).toBe(
				403,
			);
		}
		expect(await privateSql`SELECT count(*)::int AS count FROM "user"`).toEqual([{ count: 0 }]);
		expect((await signup("owner@example.com")).status).toBe(200);
	});

	it.each(["account", "session"])(
		"rolls back a failed %s write and permits a fresh retry",
		async (table) => {
			await privateSql.unsafe(`CREATE OR REPLACE FUNCTION reject_setup_write() RETURNS trigger
			LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled setup write failure'; END $$`);
			await privateSql`CREATE TRIGGER reject_setup_write BEFORE INSERT ON ${privateSql(table)}
			FOR EACH ROW EXECUTE FUNCTION reject_setup_write()`;
			expect((await signup("owner@example.com")).status).toBeGreaterThanOrEqual(400);
			for (const name of ["user", "account", "session"]) {
				expect(await privateSql`SELECT count(*)::int AS count FROM ${privateSql(name)}`).toEqual([
					{ count: 0 },
				]);
			}
			await privateSql`DROP TRIGGER reject_setup_write ON ${privateSql(table)}`;
			expect((await signup("owner@example.com")).status).toBe(200);
			expect(await privateSql`SELECT role FROM "user"`).toEqual([{ role: "admin" }]);
		},
	);

	it("keeps established instances closed while invitation signup and sign-in still work", async () => {
		const owner = await signup("owner@example.com");
		expect(owner.status).toBe(200);
		expect((await signup("public@example.com")).status).toBe(403);
		const organization = await post(
			"/organization/create",
			{ name: "Test", slug: "test" },
			owner.cookie,
		);
		expect(organization.status).toBe(200);
		const invitation = await post(
			"/organization/invite-member",
			{
				email: "invited@example.com",
				role: "member",
				organizationId: organization.data.id,
			},
			owner.cookie,
		);
		expect(invitation.status).toBe(200);
		const invited = await signup("invited@example.com", {
			"x-nixploy-invitation-id": invitation.data.id ?? "",
		});
		expect(invited.status).toBe(200);
		expect(invited.data.user?.role).not.toBe("admin");
		expect(
			(
				await post(
					"/organization/accept-invitation",
					{ invitationId: invitation.data.id },
					invited.cookie,
				)
			).status,
		).toBe(200);
		await rebuildAuth();
		expect((await signup("after-restart@example.com")).status).toBe(403);
		expect((await post("/sign-in/email", { email: "owner@example.com", password })).status).toBe(
			200,
		);
		expect(
			await privateSql`SELECT count(*)::int AS count FROM "user" WHERE role = 'admin'`,
		).toEqual([{ count: 1 }]);
	});

	it("keeps a committed owner usable when the following organization step fails", async () => {
		const owner = await signup("owner@example.com");
		expect(owner.status).toBe(200);
		await privateSql.unsafe(`CREATE OR REPLACE FUNCTION reject_setup_write() RETURNS trigger
			LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled setup write failure'; END $$`);
		await privateSql.unsafe(`CREATE TRIGGER reject_setup_write BEFORE INSERT ON "organization"
			FOR EACH ROW EXECUTE FUNCTION reject_setup_write()`);
		expect(
			(await post("/organization/create", { name: "Retry", slug: "retry" }, owner.cookie)).status,
		).toBeGreaterThanOrEqual(400);
		await privateSql.unsafe('DROP TRIGGER reject_setup_write ON "organization"');
		await rebuildAuth();
		const signedIn = await post("/sign-in/email", { email: "owner@example.com", password });
		expect(signedIn.status).toBe(200);
		expect(
			(await post("/organization/create", { name: "Retry", slug: "retry" }, signedIn.cookie))
				.status,
		).toBe(200);
		expect((await signup("public@example.com")).status).toBe(403);
	});

	it("provisions an authenticated OAuth callback as an ordinary organization member", async () => {
		const owner = await signup("owner@example.com");
		expect(owner.status).toBe(200);
		const organization = await post(
			"/organization/create",
			{ name: "SSO test", slug: "sso-test" },
			owner.cookie,
		);
		expect(organization.status).toBe(200);
		// Controlled provider: exercise state cookies, token exchange, userinfo,
		// account creation and the real SSO membership hook over HTTP.
		const provider = createServer(async (request, response) => {
			response.setHeader("content-type", "application/json");
			if (request.url === "/token" && request.method === "POST") {
				const chunks: Buffer[] = [];
				for await (const chunk of request) chunks.push(Buffer.from(chunk));
				const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
				if (form.get("code") === "test-authorization-code") {
					response.end(JSON.stringify({ access_token: "test-access-token", token_type: "Bearer" }));
					return;
				}
			} else if (
				request.url === "/userinfo" &&
				request.headers.authorization === "Bearer test-access-token"
			) {
				response.end(
					JSON.stringify({
						id: "sso-subject",
						email: "sso@example.com",
						email_verified: true,
						name: "SSO operator",
					}),
				);
				return;
			}
			response.statusCode = 401;
			response.end("{}");
		});
		await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
		try {
			const address = provider.address();
			if (!address || typeof address === "string") throw new Error("OAuth fixture has no port");
			const issuer = `http://127.0.0.1:${address.port}`;
			const { db, schema } = await import("../db");
			await db.insert(schema.ssoProviders).values({
				providerId: "setup-test",
				name: "Setup test provider",
				clientId: "test-client",
				clientSecret: "test-client-secret",
				authorizationUrl: `${issuer}/authorize`,
				tokenUrl: `${issuer}/token`,
				userInfoUrl: `${issuer}/userinfo`,
				defaultOrganizationId: organization.data.id,
				defaultRole: "member",
				allowedEmailDomains: ["example.com"],
			});
			const { invalidateSsoProviderCache } = await import("../modules/auth/sso");
			invalidateSsoProviderCache();
			await rebuildAuth();
			const start = await post("/sign-in/social", {
				provider: "setup-test",
				callbackURL: `${origin}/dashboard`,
			});
			expect(start.status).toBe(200);
			if (!start.data.url) throw new Error("OAuth authorization URL was not returned");
			const state = new URL(start.data.url).searchParams.get("state");
			expect(state).toBeTruthy();
			const callback = await fetch(
				`${origin}/api/auth/callback/setup-test?code=test-authorization-code&state=${encodeURIComponent(state ?? "")}`,
				{
					headers: { cookie: start.cookie },
					redirect: "manual",
					signal: AbortSignal.timeout(15_000),
				},
			);
			expect(callback.status).toBe(302);
			expect(callback.headers.get("location")).toBe(`${origin}/dashboard`);
			expect(await privateSql`SELECT role FROM "user" WHERE email = 'sso@example.com'`).toEqual([
				{ role: "user" },
			]);
			expect(
				await privateSql`SELECT m.role FROM "member" m JOIN "user" u ON u.id = m.user_id WHERE u.email = 'sso@example.com'`,
			).toEqual([{ role: "member" }]);
			expect(
				await privateSql`SELECT count(*)::int AS count FROM "user" WHERE role = 'admin'`,
			).toEqual([{ count: 1 }]);
		} finally {
			await new Promise<void>((resolve) => provider.close(() => resolve()));
		}
	}, 20_000);
});
