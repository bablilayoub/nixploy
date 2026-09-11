import { describe, expect, it } from "vitest";
import { walkProcedurePath } from "./rest-path";
import { appRouter } from "./root";

describe("walkProcedurePath", () => {
	it("walks nested routers segment by segment", () => {
		const tree = { a: { b: { c: () => "leaf" } } };
		expect(walkProcedurePath<() => string>(tree, "a.b.c")?.()).toBe("leaf");
		expect(walkProcedurePath(tree, "a.b")).toBe(tree.a.b);
	});

	it("returns undefined for unknown or malformed paths", () => {
		const tree = { a: { b: 1 } };
		expect(walkProcedurePath(tree, "a.x")).toBeUndefined();
		expect(walkProcedurePath(tree, "a.b.c")).toBeUndefined();
		expect(walkProcedurePath(tree, "")).toBeUndefined();
		expect(walkProcedurePath(tree, "a..b")).toBeUndefined();
		expect(walkProcedurePath(tree, "a.b.")).toBeUndefined();
	});

	it("reaches every registered procedure through a caller", () => {
		// The REST adapter used to index `caller[first][rest]`, which made any
		// nested router unreachable while it still appeared in the OpenAPI doc.
		const caller = appRouter.createCaller({} as never);
		const paths = Object.keys(appRouter._def.procedures);
		expect(paths.length).toBeGreaterThan(300);
		const missing = paths.filter((path) => typeof walkProcedurePath(caller, path) !== "function");
		expect(missing).toEqual([]);
	});
});
