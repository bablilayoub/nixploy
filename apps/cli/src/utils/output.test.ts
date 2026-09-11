import { afterEach, describe, expect, it, vi } from "vitest";
import {
	pickColumns,
	printList,
	printRaw,
	printRecord,
	printResult,
	printTable,
	printValues,
	setOutputMode,
} from "./output.js";

/** Capture everything the helpers write to stdout. */
function captureStdout(run: () => void): string {
	let captured = "";
	const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		captured += String(chunk);
		return true;
	});
	try {
		run();
	} finally {
		spy.mockRestore();
	}
	return captured;
}

const ROWS = [
	{ id: "a1", name: "api", status: "done", extra: "hidden" },
	{ id: "b2", name: "web", status: "idle", extra: "hidden" },
];

afterEach(() => {
	setOutputMode({});
});

describe("printTable", () => {
	it("pads columns and underlines the header", () => {
		const out = captureStdout(() => printTable([{ id: "a", longer: "x" }]));
		expect(out.split("\n")).toEqual(["id  longer", "--  ------", "a   x", ""]);
	});

	it("says so when there is nothing to print", () => {
		expect(captureStdout(() => printTable([]))).toBe("No results.\n");
	});

	it("renders nested values as compact JSON and nullish as empty", () => {
		const out = captureStdout(() => printTable([{ a: { k: 1 }, b: null, c: undefined }]));
		expect(out).toContain('{"k":1}');
	});
});

describe("printList", () => {
	it("prints only the picked columns as a table by default", () => {
		const out = captureStdout(() => printList(ROWS, ["id", "name", "status"]));
		expect(out).toContain("id  name  status");
		expect(out).not.toContain("hidden");
	});

	it("prints the raw payload under --json", () => {
		setOutputMode({ json: true });
		const out = captureStdout(() => printList(ROWS, ["id"]));
		expect(JSON.parse(out)).toEqual(ROWS);
	});

	it("prints one identifier per line under --quiet", () => {
		setOutputMode({ quiet: true });
		const out = captureStdout(() => printList(ROWS, ["id", "name"]));
		expect(out).toBe("a1\nb2\n");
	});

	it("--json wins over --quiet", () => {
		setOutputMode({ json: true, quiet: true });
		const out = captureStdout(() => printList(ROWS, ["id"]));
		expect(JSON.parse(out)).toEqual(ROWS);
	});

	it("wraps a single object so `one`-style payloads still render", () => {
		const out = captureStdout(() => printList(ROWS[0], ["id"]));
		expect(out).toContain("a1");
	});
});

describe("printRecord", () => {
	it("aligns key/value pairs", () => {
		const out = captureStdout(() => printRecord({ id: "a1", longKey: "v" }));
		expect(out).toBe("id       a1\nlongKey  v\n");
	});

	it("prints the first field alone under --quiet", () => {
		setOutputMode({ quiet: true });
		expect(captureStdout(() => printRecord({ id: "a1", name: "api" }))).toBe("a1\n");
	});

	it("respects an explicit column order", () => {
		const out = captureStdout(() => printRecord({ b: "2", a: "1" }, ["a", "b"]));
		expect(out.startsWith("a  1")).toBe(true);
	});
});

describe("printResult", () => {
	it("prints a confirmation by default", () => {
		expect(captureStdout(() => printResult({ ok: true }, "Done."))).toBe("Done.\n");
	});

	it("prints the payload under --json", () => {
		setOutputMode({ json: true });
		expect(JSON.parse(captureStdout(() => printResult({ id: 1 }, "Done.")))).toEqual({ id: 1 });
	});

	it("prints nothing under --quiet", () => {
		setOutputMode({ quiet: true });
		expect(captureStdout(() => printResult({ ok: true }, "Done."))).toBe("");
	});

	it("falls back to { ok: true } when the mutation returned nothing", () => {
		setOutputMode({ json: true });
		expect(JSON.parse(captureStdout(() => printResult(undefined, "Done.")))).toEqual({ ok: true });
	});
});

describe("printValues and printRaw", () => {
	it("prints scalars one per line", () => {
		expect(captureStdout(() => printValues(["a", "b"]))).toBe("a\nb\n");
	});

	it("prints scalars as JSON under --json", () => {
		setOutputMode({ json: true });
		expect(JSON.parse(captureStdout(() => printValues(["a"])))).toEqual(["a"]);
	});

	it("adds a trailing newline only when the payload lacks one", () => {
		expect(captureStdout(() => printRaw("A=1"))).toBe("A=1\n");
		expect(captureStdout(() => printRaw("A=1\n"))).toBe("A=1\n");
		expect(captureStdout(() => printRaw(""))).toBe("");
	});
});

describe("pickColumns", () => {
	it("keeps the requested order and blanks missing keys", () => {
		expect(pickColumns([{ b: 2 }], ["a", "b"])).toEqual([{ a: "", b: 2 }]);
	});
});
