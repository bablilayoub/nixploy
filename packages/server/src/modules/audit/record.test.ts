import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The audit trail is the only record of who changed what, and it is written
 * fire-and-forget from every mutation — so the two things that matter are that
 * the row shape is right and that a write failure never propagates into the
 * mutation it describes. (`index.test.ts` covers CSV export and forwarding.)
 */

const fake = vi.hoisted(() => ({
	/** Set by the `../../db` mock factory below. */
	// biome-ignore lint/suspicious/noExplicitAny: assigned from the mock factory
	db: null as any,
	failNextInsert: false,
}));

vi.mock("../../db", async () => {
	const { createFakeDb } = await import("../../test-utils/fake-db");
	fake.db = createFakeDb({
		query: { organizations: { findFirst: () => ({ name: "Acme" }) } },
		onWrite: () => {
			if (fake.failNextInsert) {
				fake.failNextInsert = false;
				throw new Error("connection terminated");
			}
		},
	});
	return { db: fake.db.db };
});

import { auditFromSession, recordAudit } from "./index";

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

/** Values of the single `audit_log` row the call wrote. */
const written = (): Record<string, unknown> => fake.db.writes[0]?.values as Record<string, unknown>;

beforeEach(() => {
	fake.db.reset();
	fake.failNextInsert = false;
	consoleError.mockClear();
});

describe("recordAudit", () => {
	it("writes one audit_log row with every omitted column as an explicit null", async () => {
		await recordAudit({ organizationId: "org-1", action: "project.create" });

		expect(fake.db.writes).toHaveLength(1);
		expect(fake.db.writes[0]).toMatchObject({ op: "insert", table: "audit_log" });
		expect(written().organizationId).toBe("org-1");
		expect(written().action).toBe("project.create");
		for (const column of ["actorId", "actorEmail", "targetType", "targetId", "targetName"]) {
			expect(written()[column], column).toBeNull();
		}
		expect(written().metadata).toBeNull();
	});

	it("JSON-stringifies metadata so the jsonb column never sees an object", async () => {
		await recordAudit({
			organizationId: "org-1",
			action: "server.update",
			targetType: "server",
			targetId: "srv-1",
			targetName: "eu-1",
			metadata: { from: "1.2.3.4", to: "5.6.7.8" },
		});

		expect(written()).toMatchObject({
			targetType: "server",
			targetId: "srv-1",
			targetName: "eu-1",
			metadata: '{"from":"1.2.3.4","to":"5.6.7.8"}',
		});
	});

	it("swallows a write failure — the mutation it describes must still succeed", async () => {
		fake.failNextInsert = true;

		await expect(
			recordAudit({ organizationId: "org-1", action: "application.delete" }),
		).resolves.toBeUndefined();

		expect(consoleError).toHaveBeenCalledWith(
			"Audit write failed (application.delete):",
			expect.any(Error),
		);
	});
});

describe("auditFromSession", () => {
	it("stamps the actor from the tRPC session", async () => {
		await auditFromSession(
			{ session: { user: { id: "user-7", email: "dev@example.test" } } },
			"org-2",
			{ action: "domain.create", targetType: "domain", targetId: "dom-1" },
		);

		expect(written()).toMatchObject({
			organizationId: "org-2",
			actorId: "user-7",
			actorEmail: "dev@example.test",
			action: "domain.create",
		});
	});

	it("records an API-key caller with no email as a null actorEmail", async () => {
		await auditFromSession({ session: { user: { id: "user-7" } } }, "org-2", {
			action: "application.deploy",
		});

		expect(written()).toMatchObject({ actorId: "user-7", actorEmail: null });
	});
});
