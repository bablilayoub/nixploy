import { describe, expect, it } from "vitest";
// One dependency-free module from the server package, imported by relative
// path: the CLI has no workspace dependency on @nixploy/server (it talks REST
// over HTTP), but the registry must not drift from the real procedure surface.
//
// Why the docs map and not `appRouter._def` directly: a static import of the
// router would make `tsc --noEmit` in this package compile the whole server
// (and fail the CLI gate on unrelated server edits). `procedure-docs.ts` has
// no imports at all, and `packages/server/src/trpc/openapi.test.ts` asserts
// the other half of the chain — every key there is a live appRouter procedure
// and every procedure is documented — so registry ⊆ docs = router.
import { procedureDocs } from "../../../../packages/server/src/trpc/procedure-docs";
import {
	buildInput,
	camelCase,
	commandRegistry,
	GROUP_DESCRIPTIONS,
	type RegistryEntry,
} from "./registry";

describe("command registry", () => {
	it("points every command at a procedure that exists on the server", () => {
		const unknown = commandRegistry
			.map((entry) => entry.procedure)
			.filter((procedure) => !(procedure in procedureDocs));
		expect(
			[...new Set(unknown)],
			"Unknown procedures in the CLI registry — add them to packages/server/src/trpc/procedure-docs.ts (which openapi.test.ts checks against the live appRouter)",
		).toEqual([]);
	});

	it("uses `<router>.<procedure>` paths", () => {
		for (const entry of commandRegistry) {
			expect(entry.procedure, `${entry.group} ${entry.verb}`).toMatch(
				/^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/,
			);
		}
	});

	it("has a unique group/verb pair per entry", () => {
		const seen = new Set<string>();
		for (const entry of commandRegistry) {
			const key = `${entry.group} ${entry.verb}`;
			expect(seen.has(key), `duplicate command: ${key}`).toBe(false);
			seen.add(key);
		}
	});

	it("describes every group it declares", () => {
		for (const group of new Set(commandRegistry.map((entry) => entry.group))) {
			expect(GROUP_DESCRIPTIONS[group], `missing GROUP_DESCRIPTIONS["${group}"]`).toBeTruthy();
		}
	});

	it("gives every entry a real summary", () => {
		for (const entry of commandRegistry) {
			expect(entry.summary.length, `${entry.group} ${entry.verb}`).toBeGreaterThan(10);
			expect(entry.summary, `${entry.group} ${entry.verb}`).not.toBe(entry.procedure);
		}
	});

	it("marks deleting verbs destructive so they require --yes", () => {
		for (const entry of commandRegistry) {
			if (!/^(delete|remove)$/.test(entry.verb)) continue;
			expect(entry.destructive, `${entry.group} ${entry.verb} must be destructive`).toBe(true);
		}
	});

	it("never puts a destructive flag on a query", () => {
		for (const entry of commandRegistry) {
			if (entry.kind !== "query") continue;
			expect(entry.destructive, `${entry.group} ${entry.verb}`).toBeFalsy();
		}
	});

	it("names option fields that commander can actually produce", () => {
		for (const entry of commandRegistry) {
			for (const option of entry.options ?? []) {
				expect(option.flag, `${entry.group} ${entry.verb}`).toMatch(/^-{1,2}/);
				expect(camelCase(option.flag).length).toBeGreaterThan(0);
			}
		}
	});

	it("covers the ops-critical lifecycle", () => {
		const commands = new Set(commandRegistry.map((entry) => `${entry.group} ${entry.verb}`));
		for (const expected of [
			"app list",
			"app create",
			"app deploy",
			"app start",
			"app stop",
			"app restart",
			"app delete",
			"compose deploy",
			"domain list",
			"domain remove",
			"backup run",
			"backup restore",
			"backup verify",
			"schedule run",
			"preview approve",
			"server setup",
			"project delete",
			"updates apply",
		]) {
			expect(commands.has(expected), `missing command: ${expected}`).toBe(true);
		}
	});
});

describe("camelCase", () => {
	it("mirrors commander's option-name derivation", () => {
		expect(camelCase("--project-id <id>")).toBe("projectId");
		expect(camelCase("-y, --yes")).toBe("yes");
		expect(camelCase("--env <name>")).toBe("env");
		expect(camelCase("--server-id <id>")).toBe("serverId");
		expect(camelCase("--keep-latest-count <n>")).toBe("keepLatestCount");
	});
});

describe("buildInput", () => {
	const entry: RegistryEntry = {
		group: "test",
		verb: "run",
		procedure: "project.all",
		kind: "query",
		summary: "Test entry for the input mapper",
		argument: { field: "projectId", label: "<projectId>", description: "Project ID" },
		options: [
			{ field: "environmentName", flag: "--env <name>", description: "Environment" },
			{ field: "limit", flag: "--limit <n>", description: "Limit", type: "number" },
			{ field: "force", flag: "--force", description: "Force", type: "boolean" },
			{ field: "hours", flag: "--hours <n>", description: "Hours", type: "number", fallback: 1 },
		],
		fixed: { databaseType: "postgres" },
	};

	it("maps the positional argument, flags and fixed fields", () => {
		expect(buildInput(entry, "proj-1", { env: "staging", limit: "5", force: true })).toEqual({
			databaseType: "postgres",
			projectId: "proj-1",
			environmentName: "staging",
			limit: 5,
			force: true,
			hours: 1,
		});
	});

	it("omits flags that were not passed and applies fallbacks", () => {
		expect(buildInput(entry, "proj-1", {})).toEqual({
			databaseType: "postgres",
			projectId: "proj-1",
			hours: 1,
		});
	});

	it("rejects a non-numeric value for a number flag with a usage error", () => {
		expect(() => buildInput(entry, "proj-1", { limit: "many" })).toThrow(
			/--limit <n> expects a number/,
		);
	});
});
