import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FakeWrite } from "../test-utils/fake-db";
import { fakeTRPCContext } from "../test-utils/fake-session";

/**
 * Authorization matrix over EVERY mutation on `appRouter`.
 *
 * Until now mutation authz had no cross-cutting coverage at all: the tenancy
 * suite only exercises 21 read procedures (`tenancy-coverage.ts`), so a new
 * router could ship a `create`/`delete` with no `assertCapability` and nothing
 * would notice (audit F8).
 *
 * The shape of the test: call every mutation as a **viewer** member with a
 * generated-but-valid input, against a database double that throws on any
 * write. A viewer holds only read capabilities, so each call must reject — and
 * it must reject *before* touching the database. Procedures that are
 * legitimately viewer-callable are allow-listed below with a reason.
 *
 * The capability logic itself is NOT mocked: the double answers
 * `members.findFirst` with a real viewer membership row, so
 * `effectiveCapabilities("viewer")` decides, exactly as in production.
 */

const state = vi.hoisted(() => ({
	// biome-ignore lint/suspicious/noExplicitAny: assigned from the mock factory
	db: null as any,
	/** Shell/SSH calls a mutation managed to start (must stay empty). */
	execCalls: [] as string[],
}));

/** Marker thrown by the double so a write is distinguishable from a bug. */
const WRITE_MARKER = "FAKE_DB_WRITE";

vi.mock("../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../db")>();
	const { createFakeDb } = await import("../test-utils/fake-db");
	state.db = createFakeDb({
		query: {
			members: {
				findFirst: () => ({
					id: "member-1",
					userId: "user-1",
					organizationId: "org-1",
					role: "viewer",
					capabilityOverrides: null,
					createdAt: new Date(0),
				}),
			},
		},
		onWrite: (write) => {
			throw new Error(`${WRITE_MARKER}: ${write.op} ${write.table}`);
		},
	});
	return { ...actual, db: state.db.db, client: vi.fn() };
});

vi.mock("../utils/exec", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/exec")>();
	const refuse = (command: string) => {
		state.execCalls.push(command);
		throw new Error(`unexpected shell command: ${command}`);
	};
	return {
		...actual,
		execAsync: async (command: string) => refuse(command),
		execAsyncRemote: async (_serverId: string, command: string) => refuse(command),
		execAsyncWithStdin: async (command: string) => refuse(command),
		execAsyncRemoteWithStdin: async (_serverId: string, command: string) => refuse(command),
	};
});

vi.mock("../modules/audit", () => ({
	recordAudit: async () => {},
	auditFromSession: async () => {},
}));

import { appRouter } from "./root";

// ── procedure enumeration ───────────────────────────────────────────────────

interface ProcedureDef {
	_def?: { type?: string; inputs?: unknown[] };
}

/** `<router>.<procedure>` → def, for every mutation the app router exposes. */
function mutationPaths(): string[] {
	const procedures = appRouter._def.procedures as Record<string, ProcedureDef>;
	return Object.entries(procedures)
		.filter(([, procedure]) => procedure._def?.type === "mutation")
		.map(([path]) => path)
		.sort();
}

function inputSchema(path: string): unknown {
	const procedures = appRouter._def.procedures as Record<string, ProcedureDef>;
	return procedures[path]?._def?.inputs?.[0];
}

// ── input generation ────────────────────────────────────────────────────────
//
// Inputs come from the procedure's own zod schema, converted to JSON Schema
// (the same conversion `openapi.ts` and `query-input.ts` use) and filled with
// the smallest value each node accepts. A schema this cannot satisfy (an
// exotic `pattern`, say) makes the call fail with BAD_REQUEST, which still
// proves the point that matters: no write happened.

type JsonSchema = Record<string, unknown>;

const STRING_BY_FORMAT: Record<string, string> = {
	uri: "https://example.test/hook",
	url: "https://example.test/hook",
	email: "person@example.test",
	uuid: "00000000-0000-4000-8000-000000000000",
	"date-time": "2026-09-11T10:00:00.000Z",
	hostname: "example.test",
	ipv4: "203.0.113.10",
};

function sampleValue(schema: JsonSchema | undefined, depth = 0): unknown {
	if (!schema || depth > 6) return "x";
	if ("const" in schema) return schema.const;
	if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
	for (const key of ["anyOf", "oneOf", "allOf"] as const) {
		const variants = schema[key];
		if (Array.isArray(variants) && variants.length > 0) {
			// Prefer a non-null branch: `z.string().nullable()` should give a string.
			const preferred =
				(variants as JsonSchema[]).find((variant) => variant.type !== "null") ??
				(variants[0] as JsonSchema);
			return sampleValue(preferred, depth + 1);
		}
	}
	const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
	switch (type) {
		case "string": {
			const format = typeof schema.format === "string" ? STRING_BY_FORMAT[schema.format] : null;
			if (format) return format;
			const min = typeof schema.minLength === "number" ? schema.minLength : 1;
			return "x".repeat(Math.max(min, 1));
		}
		case "integer":
		case "number": {
			const min = typeof schema.minimum === "number" ? schema.minimum : 1;
			const max = typeof schema.maximum === "number" ? schema.maximum : min;
			return Math.min(Math.max(min, 1), max);
		}
		case "boolean":
			return false;
		case "null":
			return null;
		case "array": {
			const items = sampleValue(schema.items as JsonSchema | undefined, depth + 1);
			const min = typeof schema.minItems === "number" ? schema.minItems : 0;
			return min > 0 ? Array.from({ length: min }, () => items) : [];
		}
		default: {
			const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
			const required = new Set((Array.isArray(schema.required) ? schema.required : []).map(String));
			const out: Record<string, unknown> = {};
			for (const [name, property] of Object.entries(properties)) {
				if (required.has(name)) out[name] = sampleValue(property, depth + 1);
			}
			return out;
		}
	}
}

function sampleInput(path: string): unknown {
	const schema = inputSchema(path);
	if (!schema) return undefined;
	try {
		return sampleValue(z.toJSONSchema(schema as z.ZodType, { io: "input" }) as JsonSchema);
	} catch {
		return {};
	}
}

// ── allow-list ──────────────────────────────────────────────────────────────

/**
 * Mutations a viewer may legitimately call — for example something that acts
 * on the caller's own account rather than on tenant data. Empty today: every
 * mutation on the app router rejects a viewer. Adding an entry is a security
 * decision, so each one carries the reason:
 *
 * ```ts
 * ["organization.setActive", "acts on the caller's own session"],
 * ```
 */
const VIEWER_CALLABLE = new Map<string, string>();

// ── the matrix ──────────────────────────────────────────────────────────────

interface Outcome {
	path: string;
	resolved: boolean;
	code: string;
	message: string;
	writes: FakeWrite[];
}

async function callAsViewer(path: string): Promise<Outcome> {
	state.db.reset();
	state.execCalls = [];
	const caller = appRouter.createCaller(fakeTRPCContext({ role: "user" })) as unknown as Record<
		string,
		Record<string, (input?: unknown) => Promise<unknown>>
	>;
	const [routerName = "", procedureName = ""] = path.split(".");
	const procedure = caller[routerName]?.[procedureName];
	if (!procedure) {
		return { path, resolved: false, code: "MISSING", message: "not callable", writes: [] };
	}
	try {
		await procedure(sampleInput(path));
		return { path, resolved: true, code: "RESOLVED", message: "", writes: [...state.db.writes] };
	} catch (error) {
		const wrapped = error as { code?: string; message?: string };
		return {
			path,
			resolved: false,
			code: wrapped.code ?? "UNKNOWN",
			message: wrapped.message ?? String(error),
			writes: [...state.db.writes],
		};
	}
}

const outcomes: Outcome[] = [];

describe("capability matrix", () => {
	it("collects one outcome per mutation", async () => {
		const paths = mutationPaths();
		// 207 at the time of writing; the floor catches a router that stopped
		// being registered in `root.ts` (which would silently empty the matrix).
		expect(paths.length).toBeGreaterThan(150);
		for (const path of paths) {
			outcomes.push(await callAsViewer(path));
		}
		expect(outcomes).toHaveLength(paths.length);
	}, 60_000);

	it("never lets a viewer reach a database write", () => {
		const wrote = outcomes
			.filter((outcome) => outcome.writes.length > 0)
			.map((outcome) => `${outcome.path} → ${outcome.writes[0]?.op} ${outcome.writes[0]?.table}`);
		expect(wrote).toEqual([]);
	});

	it("never lets a viewer reach a shell or SSH command", () => {
		expect(state.execCalls).toEqual([]);
	});

	it("rejects every mutation that is not explicitly viewer-callable", () => {
		const resolved = outcomes
			.filter((outcome) => outcome.resolved && !VIEWER_CALLABLE.has(outcome.path))
			.map((outcome) => outcome.path);
		expect(resolved).toEqual([]);
	});

	it("rejects with a client error, never an unhandled server error", () => {
		const CLIENT_ERRORS = new Set([
			"FORBIDDEN",
			"UNAUTHORIZED",
			"BAD_REQUEST",
			"NOT_FOUND",
			"PRECONDITION_FAILED",
			"CONFLICT",
		]);
		const unexpected = outcomes
			.filter((outcome) => !outcome.resolved && !CLIENT_ERRORS.has(outcome.code))
			.map((outcome) => `${outcome.path}: ${outcome.code} ${outcome.message}`);
		expect(unexpected).toEqual([]);
	});

	it("stops the overwhelming majority at the capability / role gate", () => {
		const gated = outcomes.filter(
			(outcome) => outcome.code === "FORBIDDEN" || outcome.code === "UNAUTHORIZED",
		);
		// 197 of 207 at the time of writing. The rest reject a step earlier, on a
		// cross-field zod refinement ("exactly one of applicationId or composeId")
		// or an org-scoped lookup that finds nothing — both still before any
		// write, which the assertions above already prove.
		expect(gated.length).toBeGreaterThan(outcomes.length * 0.9);
	});
});
