import { describe, expect, it } from "vitest";
import {
	assertResolvedInsideData,
	assertVolumeName,
	buildDeleteCommand,
	buildListCommand,
	buildMkdirCommand,
	buildReadCommand,
	buildWriteCommand,
	DATA_MOUNT,
	describeVolumeFileError,
	exitCodeOf,
	looksBinary,
	MAX_READ_BYTES,
	normalizeVolumePath,
	parseListOutput,
	splitResolved,
} from "./volume-files";

/**
 * Read one POSIX single-quoted word (including the `'\''` escape used to
 * embed an apostrophe) starting at `start`, and return its literal value.
 */
function readSingleQuoted(text: string, start: number): { value: string; end: number } {
	let index = start + 1;
	let value = "";
	while (index < text.length) {
		if (text[index] === "'") {
			// `'\''` — close, escaped apostrophe, reopen.
			if (text.slice(index, index + 4) === String.raw`'\''`) {
				value += "'";
				index += 4;
				continue;
			}
			return { value, end: index + 1 };
		}
		value += text[index];
		index += 1;
	}
	return { value, end: index };
}

describe("normalizeVolumePath", () => {
	it("treats empty, '/' and the mount itself as the volume root", () => {
		expect(normalizeVolumePath("")).toBe(DATA_MOUNT);
		expect(normalizeVolumePath(null)).toBe(DATA_MOUNT);
		expect(normalizeVolumePath("/")).toBe(DATA_MOUNT);
		expect(normalizeVolumePath("/data")).toBe(DATA_MOUNT);
	});

	it("accepts relative and mounted forms of the same path", () => {
		expect(normalizeVolumePath("logs/app.log")).toBe("/data/logs/app.log");
		expect(normalizeVolumePath("/logs/app.log")).toBe("/data/logs/app.log");
		expect(normalizeVolumePath("/data/logs/app.log")).toBe("/data/logs/app.log");
		expect(normalizeVolumePath("//logs///app.log")).toBe("/data/logs/app.log");
	});

	it("rejects every lexical escape", () => {
		expect(() => normalizeVolumePath("..")).toThrow(/'\.' or '\.\.'/);
		expect(() => normalizeVolumePath("../etc/passwd")).toThrow(/'\.' or '\.\.'/);
		expect(() => normalizeVolumePath("/data/../etc/passwd")).toThrow(/'\.' or '\.\.'/);
		expect(() => normalizeVolumePath("logs/../../etc/shadow")).toThrow(/'\.' or '\.\.'/);
		expect(() => normalizeVolumePath("./secret")).toThrow(/'\.' or '\.\.'/);
	});

	it("rejects null bytes and backslashes", () => {
		expect(() => normalizeVolumePath("a\0b")).toThrow(/null byte/);
		expect(() => normalizeVolumePath("..\\..\\etc")).toThrow(/backslash/);
	});

	it("caps depth and length", () => {
		expect(() => normalizeVolumePath(Array(70).fill("a").join("/"))).toThrow(/nested too deeply/);
		expect(() => normalizeVolumePath("x".repeat(1100))).toThrow(/too long/);
	});

	it("leaves an absolute path that merely starts with 'data' alone", () => {
		// `/database` must not be confused with the `/data` mount prefix.
		expect(normalizeVolumePath("/database/dump.sql")).toBe("/data/database/dump.sql");
	});
});

describe("assertResolvedInsideData", () => {
	it("accepts the mount and anything under it", () => {
		expect(assertResolvedInsideData("/data")).toBe("/data");
		expect(assertResolvedInsideData("/data/logs/app.log\n")).toBe("/data/logs/app.log");
	});

	it("rejects a realpath that left the mount — the symlink case", () => {
		// `ln -s /etc /data/escape` then reading /data/escape/passwd: the input
		// path is lexically clean, only the RESOLVED path gives it away.
		expect(() => assertResolvedInsideData("/etc/passwd")).toThrow(/escapes the volume/);
		expect(() => assertResolvedInsideData("/datastore/x")).toThrow(/escapes the volume/);
		expect(() => assertResolvedInsideData("/")).toThrow(/escapes the volume/);
	});
});

describe("assertVolumeName", () => {
	it("accepts docker-shaped names", () => {
		expect(() => assertVolumeName("nixploy-e2e-files")).not.toThrow();
		expect(() => assertVolumeName("shop_data.1")).not.toThrow();
	});

	it("rejects shell metacharacters and path separators", () => {
		for (const name of ["../x", "a b", "a;rm -rf /", "$(id)", "-leading", ""]) {
			expect(() => assertVolumeName(name)).toThrow(/Invalid volume name/);
		}
	});

	it("refuses the platform's own database volume", () => {
		expect(() => assertVolumeName("nixploy-postgres-data")).toThrow(/Nixploy's own database/);
	});
});

describe("command builders", () => {
	it("mounts read-only, drops the network and keeps the hardening baseline", () => {
		const command = buildListCommand("shop_data", "/data/logs");
		expect(command).toContain("docker run --rm");
		expect(command).toContain("--network none");
		expect(command).toContain("-v 'shop_data:/data:ro'");
		expect(command).toContain("--cap-drop ALL");
		expect(command).toContain("--security-opt no-new-privileges");
		expect(command).toContain("--entrypoint sh");
		expect(command).toContain("alpine");
	});

	it("mounts writable only for mutations", () => {
		expect(buildWriteCommand("shop_data", "/data/a.txt")).toContain("-v 'shop_data:/data'");
		expect(buildDeleteCommand("shop_data", "/data/a.txt")).toContain("-v 'shop_data:/data'");
		expect(buildMkdirCommand("shop_data", "/data/new")).toContain("-v 'shop_data:/data'");
		expect(buildReadCommand("shop_data", "/data/a.txt")).toContain("-v 'shop_data:/data:ro'");
	});

	it("opens stdin for writes so the payload never reaches argv", () => {
		const command = buildWriteCommand("shop_data", "/data/a.txt");
		expect(command).toContain("docker run --rm -i");
		// The script only ever *reads* stdin — no heredoc, no inline payload.
		expect(command.trimEnd().endsWith(`base64 -d > "$T"'`)).toBe(true);
		expect(command).not.toContain("<<");
	});

	it("re-checks the prefix inside the container as well", () => {
		for (const command of [
			buildListCommand("v", "/data/x"),
			buildReadCommand("v", "/data/x"),
			buildWriteCommand("v", "/data/x"),
			buildDeleteCommand("v", "/data/x"),
			buildMkdirCommand("v", "/data/x"),
		]) {
			expect(command).toContain("realpath");
			expect(command).toContain("case ");
			expect(command).toContain("exit 45");
		}
	});

	it("quotes the path so a hostile name cannot break out of the script", () => {
		// The path is quoted inside the script and the script is quoted again
		// for `docker run -c`, so the only honest assertion is a round trip:
		// unquote both layers and get the original string back, apostrophes,
		// semicolons and all.
		const hostile = "/data/x'; rm -rf / ; echo 'y";
		const command = buildReadCommand("v", hostile);
		const script = readSingleQuoted(command, command.indexOf("-c '") + 3).value;
		const path = readSingleQuoted(script, script.indexOf("P=") + 2).value;
		expect(path).toBe(hostile);
		// The `rm` is inside the assignment, never a command of its own: the
		// script's first statement still ends at the assignment's own `;`.
		expect(script.split(`P=`)[1]?.startsWith("'")).toBe(true);
		expect(script.indexOf("; T=$(realpath")).toBeGreaterThan(script.indexOf("rm -rf /"));
	});

	it("enforces the read cap in the container, not after streaming the file", () => {
		expect(buildReadCommand("v", "/data/big.log")).toContain(`-le ${MAX_READ_BYTES}`);
	});

	it("refuses to delete the mount point itself", () => {
		expect(buildDeleteCommand("v", "/data/x")).toContain('[ "$T" = "/data" ] && exit 49');
	});

	it("deletes a symlink rather than what it points at", () => {
		// Parent-resolved, so `rm -rf` targets the link itself. Resolving the
		// path would make `rm -rf /data/escape` delete /etc inside the
		// container instead of removing the stray link.
		const command = buildDeleteCommand("v", "/data/escape");
		expect(command).toContain('D=$(dirname "$P")');
		expect(command).toContain('T="$R/$B"');
		expect(command).toContain('rm -rf -- "$T"');
	});

	it("reports a missing path instead of succeeding silently", () => {
		// `realpath` on BusyBox resolves a path that does not exist and
		// `rm -rf` is happy to remove nothing, so both need an explicit check.
		expect(buildReadCommand("v", "/data/x")).toContain('[ -e "$T" ] || exit 44');
		expect(buildDeleteCommand("v", "/data/x")).toContain("|| exit 44");
	});
});

describe("splitResolved + parseListOutput", () => {
	it("peels the resolved path off the first line", () => {
		expect(splitResolved("/data/logs\nregular file|1|2|/data/logs/a\n")).toEqual({
			resolved: "/data/logs",
			body: "regular file|1|2|/data/logs/a\n",
		});
		expect(splitResolved("/data")).toEqual({ resolved: "/data", body: "" });
	});

	it("parses stat lines, sorting directories first", () => {
		const body = [
			"regular file|120|1700000000|/data/b.txt",
			"directory|4096|1700000100|/data/logs",
			"symbolic link|7|1700000200|/data/link",
			"regular file|0|1700000300|/data/a.txt",
		].join("\n");
		expect(parseListOutput(body, "/data")).toEqual([
			{ name: "logs", type: "directory", size: 4096, modifiedAt: 1_700_000_100_000 },
			{ name: "a.txt", type: "file", size: 0, modifiedAt: 1_700_000_300_000 },
			{ name: "b.txt", type: "file", size: 120, modifiedAt: 1_700_000_000_000 },
			{ name: "link", type: "symlink", size: 7, modifiedAt: 1_700_000_200_000 },
		]);
	});

	it("keeps a pipe in a file name (only the first three separators count)", () => {
		const entries = parseListOutput("regular file|5|1700000000|/data/we|ird.txt", "/data");
		expect(entries).toEqual([
			{ name: "we|ird.txt", type: "file", size: 5, modifiedAt: 1_700_000_000_000 },
		]);
	});

	it("drops entries from another directory or with a nested name", () => {
		const body = [
			"regular file|1|1|/elsewhere/x",
			"regular file|1|1|/data/logs/deep/x",
			"regular file|1|1|/data/logs/ok",
		].join("\n");
		expect(parseListOutput(body, "/data/logs").map((entry) => entry.name)).toEqual(["ok"]);
	});

	it("ignores malformed and empty lines", () => {
		expect(parseListOutput("\ngarbage\nregular file|1|1\n", "/data")).toEqual([]);
	});
});

describe("looksBinary", () => {
	it("flags content with a NUL byte", () => {
		expect(looksBinary(Buffer.from("hello"))).toBe(false);
		expect(looksBinary(Buffer.from([0x68, 0x00, 0x69]))).toBe(true);
	});
});

describe("error mapping", () => {
	it("reads the exit code off every exec helper's error shape", () => {
		expect(exitCodeOf({ exitCode: 45 })).toBe(45);
		expect(exitCodeOf({ code: 44 })).toBe(44);
		expect(exitCodeOf(new Error('"docker" failed (exit 47): nope'))).toBe(47);
		expect(exitCodeOf(new Error("something else"))).toBeNull();
	});

	it("turns script exit codes into messages an operator can act on", () => {
		expect(describeVolumeFileError({ exitCode: 44 }, "/data/x").message).toMatch(/No such file/);
		expect(describeVolumeFileError({ exitCode: 45 }, "/data/x").message).toMatch(/escapes/);
		expect(describeVolumeFileError({ exitCode: 47 }, "/data/x").message).toMatch(/larger than/);
		expect(describeVolumeFileError({ exitCode: 49 }, "/data").message).toMatch(/volume root/);
		expect(describeVolumeFileError({ exitCode: 50 }, "/data/x").message).toMatch(/already exists/);
	});

	it("passes an unrecognised failure through unchanged", () => {
		const error = new Error("docker daemon is not running");
		expect(describeVolumeFileError(error, "/data/x")).toBe(error);
	});
});
