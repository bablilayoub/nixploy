import { describe, expect, it } from "vitest";
import { assertSafeTarEntry } from "./tar";

const row = (name: string, type = "-") =>
	`${type}rwxr-xr-x root/root       12 2026-10-15 20:34:00 ${name}`;
describe("restore tar policy", () => {
	it("allows regular files/directories and resolved long names with spaces", () => {
		for (const name of ["./", "./file with spaces", `./${"long".repeat(90)}/file`])
			expect(() => assertSafeTarEntry(row(name))).not.toThrow();
		expect(() => assertSafeTarEntry(row("./data/", "d"), "data")).not.toThrow();
	});
	it.each(["/etc/passwd", "../outside", "./data/../../escape", "./data/bad\tname"])(
		"refuses unsafe path %s",
		(name) => {
			expect(() => assertSafeTarEntry(row(name))).toThrow(/unsafe path/);
		},
	);
	it.each(["h", "b", "c", "p"])("refuses tar type %s before extraction", (type) => {
		expect(() => assertSafeTarEntry(row("./name", type))).toThrow(/special files/);
	});
	it("allows confined relative symlinks/hardlinks and refuses escape targets", () => {
		expect(() => assertSafeTarEntry(row("./payload-link -> payload.bin", "l"))).not.toThrow();
		expect(() => assertSafeTarEntry(row("data/link -> data/file"), "data")).not.toThrow();
		for (const target of ["/etc/passwd", "../outside", "dir/../../outside"])
			expect(() => assertSafeTarEntry(row(`./link -> ${target}`, "l"))).toThrow(/unsafe link/);
		expect(() => assertSafeTarEntry(row("data/link -> etc/secret"), "data")).toThrow(
			/leaves its data subtree/,
		);
	});
	it("rejects ambiguous rows and Redis entries outside data/", () => {
		expect(() => assertSafeTarEntry("newline filename continuation")).toThrow();
		expect(() => assertSafeTarEntry(row("./etc/redis.conf"), "data")).toThrow(
			/data\/ data subtree/,
		);
	});
});
