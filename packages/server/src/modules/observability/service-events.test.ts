import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../deployment/notify", () => ({ publishPlatformEventDetached: () => {} }));

import { decodeServiceEventCursor, encodeServiceEventCursor } from "./service-events";

describe("service event cursor", () => {
	it("round-trips an instant and an id", () => {
		const occurredAt = new Date("2026-09-17T12:00:00.000Z");
		const cursor = encodeServiceEventCursor({ occurredAt, serviceEventId: "evt-1" });
		expect(decodeServiceEventCursor(cursor)).toEqual({ occurredAt, serviceEventId: "evt-1" });
	});

	it("keeps the id intact when it contains the separator", () => {
		const occurredAt = new Date("2026-09-17T12:00:00.000Z");
		const cursor = encodeServiceEventCursor({ occurredAt, serviceEventId: "a|b|c" });
		expect(decodeServiceEventCursor(cursor)?.serviceEventId).toBe("a|b|c");
	});

	it("rejects anything it cannot read instead of paging from the epoch", () => {
		for (const cursor of ["", "|evt-1", "not-a-date|evt-1", "2026-09-17T12:00:00.000Z|", "nope"]) {
			expect(decodeServiceEventCursor(cursor), cursor).toBeNull();
		}
	});
});
