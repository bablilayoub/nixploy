/**
 * Tenant isolation suite.
 *
 * Requires `DATABASE_URL_TEST` (a throwaway Postgres). Skips when unset so the
 * default unit-test run stays offline. CI sets the env after migrating.
 *
 * DATABASE_URL is assigned from DATABASE_URL_TEST before any dynamic import of
 * `db` / routers so the lazy client targets the test database.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantFixture } from "./tenancy.harness";
import { COVERED, EXEMPT, isListOrGetProcedure } from "./tenancy-coverage";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("tenant isolation", () => {
	type Harness = typeof import("./tenancy.harness");

	let harness: Harness;
	let a: TenantFixture;
	let b: TenantFixture;
	let callerA: ReturnType<Harness["createTestCaller"]>;
	let callerB: ReturnType<Harness["createTestCaller"]>;

	beforeAll(async () => {
		process.env.DATABASE_URL = testUrl as string;
		// Domain mutations write Traefik YAML under the config dir; CI runs as
		// a plain user where the production default (/etc/nixploy) is not writable.
		if (!process.env.NIXPLOY_CONFIG_DIR) {
			process.env.NIXPLOY_CONFIG_DIR = await mkdtemp(join(tmpdir(), "nixploy-tenancy-"));
		}
		harness = await import("./tenancy.harness");
		({ a, b } = await harness.seedTwoTenants());
		callerA = harness.createTestCaller(a.session);
		callerB = harness.createTestCaller(b.session);
	}, 60_000);

	afterAll(async () => {
		if (a) await harness.wipeTenant(a);
		if (b) await harness.wipeTenant(b);
	});

	const expectDenied = async (promise: Promise<unknown>) => {
		await expect(promise).rejects.toSatisfy((err: unknown) => {
			const code = (err as { code?: string } | null)?.code;
			return code === "NOT_FOUND" || code === "FORBIDDEN";
		});
	};

	it("project.all returns only the caller's org", async () => {
		const listA = await callerA.project.all();
		const listB = await callerB.project.all();
		expect(listA.map((p) => p.projectId)).toEqual([a.projectId]);
		expect(listB.map((p) => p.projectId)).toEqual([b.projectId]);
	});

	it("project.one rejects the other org's project id", async () => {
		const own = await callerA.project.one({ projectId: a.projectId });
		expect(own.projectId).toBe(a.projectId);
		await expectDenied(callerA.project.one({ projectId: b.projectId }));
	});

	it("application.all / one are org-scoped", async () => {
		const listA = await callerA.application.all({ projectId: a.projectId });
		expect(listA.map((row) => row.applicationId)).toEqual([a.applicationId]);
		await expectDenied(callerA.application.all({ projectId: b.projectId }));
		const own = await callerA.application.one({ applicationId: a.applicationId });
		expect(own.applicationId).toBe(a.applicationId);
		await expectDenied(callerA.application.one({ applicationId: b.applicationId }));
	});

	it("compose.all / one are org-scoped", async () => {
		const listA = await callerA.compose.all({ projectId: a.projectId });
		expect(listA.map((row) => row.composeId)).toEqual([a.composeId]);
		await expectDenied(callerA.compose.all({ projectId: b.projectId }));
		await expectDenied(callerA.compose.one({ composeId: b.composeId }));
	});

	it("server.all / one are org-scoped", async () => {
		const listA = await callerA.server.all();
		expect(listA.map((row) => row.serverId)).toEqual([a.serverId]);
		expect((await callerB.server.all()).map((row) => row.serverId)).toEqual([b.serverId]);
		await expectDenied(callerA.server.one({ serverId: b.serverId }));
	});

	it("destination.all / one are org-scoped", async () => {
		const listA = await callerA.destination.all();
		expect(listA.map((row) => row.destinationId)).toEqual([a.destinationId]);
		await expectDenied(callerA.destination.one({ destinationId: b.destinationId }));
	});

	it("registry.all / one are org-scoped", async () => {
		const listA = await callerA.registry.all();
		expect(listA.map((row) => row.registryId)).toEqual([a.registryId]);
		await expectDenied(callerA.registry.one({ registryId: b.registryId }));
	});

	it("sshKey.all / one are org-scoped", async () => {
		const listA = await callerA.sshKey.all();
		expect(listA.map((row) => row.sshKeyId)).toEqual([a.sshKeyId]);
		await expectDenied(callerA.sshKey.one({ sshKeyId: b.sshKeyId }));
	});

	it("certificate.all / one are org-scoped", async () => {
		const listA = await callerA.certificate.all();
		expect(listA.map((row) => row.certificateId)).toEqual([a.certificateId]);
		await expectDenied(callerA.certificate.one({ certificateId: b.certificateId }));
	});

	it("notification.all / one are org-scoped", async () => {
		const listA = await callerA.notification.all();
		expect(listA.map((row) => row.notificationId)).toEqual([a.notificationId]);
		await expectDenied(callerA.notification.one({ notificationId: b.notificationId }));
	});

	it("postgres.all / one are org-scoped", async () => {
		const listA = await callerA.postgres.all({ projectId: a.projectId });
		expect(listA.map((row) => row.postgresId)).toEqual([a.postgresId]);
		await expectDenied(callerA.postgres.all({ projectId: b.projectId }));
		await expectDenied(callerA.postgres.one({ postgresId: b.postgresId }));
	});

	it("tag.all returns only the caller's org tags", async () => {
		const tagA = await callerA.tag.create({ name: `a-${Date.now()}`, color: "#112233" });
		const tagB = await callerB.tag.create({ name: `b-${Date.now()}`, color: "#445566" });
		expect(tagA?.tagId).toBeTruthy();
		expect(tagB?.tagId).toBeTruthy();
		const listA = await callerA.tag.all();
		const listB = await callerB.tag.all();
		expect(listA.map((row) => row.tagId)).toContain(tagA?.tagId);
		expect(listA.map((row) => row.tagId)).not.toContain(tagB?.tagId);
		expect(listB.map((row) => row.tagId)).toContain(tagB?.tagId);
		expect(listB.map((row) => row.tagId)).not.toContain(tagA?.tagId);
	});

	it("domain.create refuses a host another org already routes (any port, any path)", async () => {
		const host = `shared-${Date.now()}.example.test`;
		const created = await callerA.domain.create({
			host,
			applicationId: a.applicationId,
			port: 3000,
		});
		expect(created.host).toBe(host);

		const expectConflict = async (promise: Promise<unknown>) => {
			await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
		};
		// Different port / NULL port never made the DB index fire.
		await expectConflict(
			callerB.domain.create({ host, applicationId: b.applicationId, port: 8080 }),
		);
		await expectConflict(callerB.domain.create({ host, applicationId: b.applicationId }));
		// A sub-path on someone else's host is exactly the hijack (longer
		// PathPrefix wins in Traefik); case folding must not bypass it.
		await expectConflict(
			callerB.domain.create({
				host: host.toUpperCase(),
				path: "/api",
				applicationId: b.applicationId,
				port: 8080,
			}),
		);
		// Same org, same host + path on any service: still a conflict.
		await expectConflict(
			callerA.domain.create({ host, applicationId: a.applicationId, port: 4000 }),
		);
		// Same org, another path: legitimate multi-service host.
		const api = await callerA.domain.create({
			host,
			path: "/api",
			applicationId: a.applicationId,
			port: 3000,
		});
		expect(api.path).toBe("/api");
		// Updating the other org's own domain onto the taken host is rejected too.
		const own = await callerB.domain.create({
			host: `own-${Date.now()}.example.test`,
			applicationId: b.applicationId,
			port: 3000,
		});
		await expectConflict(callerB.domain.update({ domainId: own.domainId, host }));
	});
});

describe("tenancy coverage registry", () => {
	it("lists every *.all / *.one / *.list procedure as COVERED or EXEMPT", async () => {
		const { appRouter } = await import("./root");
		const procedures = Object.keys(appRouter._def.procedures);
		const listGets = procedures.filter(isListOrGetProcedure).sort();
		const known = new Set<string>([...COVERED, ...EXEMPT]);
		const missing = listGets.filter((path) => !known.has(path));
		const staleCovered = COVERED.filter((path) => !procedures.includes(path));
		const staleExempt = EXEMPT.filter((path) => !procedures.includes(path));
		expect(missing, `Add to COVERED or EXEMPT: ${missing.join(", ")}`).toEqual([]);
		expect(staleCovered, `Remove stale COVERED entries: ${staleCovered.join(", ")}`).toEqual([]);
		expect(staleExempt, `Remove stale EXEMPT entries: ${staleExempt.join(", ")}`).toEqual([]);
	});
});
