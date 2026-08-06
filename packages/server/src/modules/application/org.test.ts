import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveMock = vi.fn();

vi.mock("../projects", () => ({
	resolveCallerOrganizationId: (...args: unknown[]) => resolveMock(...args),
}));

const { getOrganizationId } = await import("./org");

type FakeSession = Parameters<typeof getOrganizationId>[0];

const makeSession = (userId: string, orgId: string | null): FakeSession =>
	({
		user: { id: userId },
		session: { activeOrganizationId: orgId },
	}) as FakeSession;

describe("getOrganizationId", () => {
	beforeEach(() => {
		resolveMock.mockReset();
		resolveMock.mockResolvedValue("org_1");
	});

	it("resolves membership once across multiple calls on the same session", async () => {
		const session = makeSession("user_1", "org_1");
		const results = await Promise.all([
			getOrganizationId(session),
			getOrganizationId(session),
			getOrganizationId(session),
		]);
		expect(results).toEqual(["org_1", "org_1", "org_1"]);
		expect(resolveMock).toHaveBeenCalledTimes(1);
		expect(resolveMock).toHaveBeenCalledWith("user_1", "org_1");
	});

	it("resolves again for a different session object", async () => {
		await getOrganizationId(makeSession("user_1", "org_1"));
		await getOrganizationId(makeSession("user_1", "org_1"));
		expect(resolveMock).toHaveBeenCalledTimes(2);
	});
});
