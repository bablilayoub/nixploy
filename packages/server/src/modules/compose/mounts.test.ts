import { describe, expect, it } from "vitest";
import { type ComposeMount, injectComposeMounts } from "./mounts";
import { parseComposeFile } from "./parse";

const spec = () =>
	parseComposeFile(`
services:
  api:
    image: api:latest
  cache:
    image: redis:8-alpine
    volumes:
      - cache-data:/data
volumes:
  cache-data:
    driver: local
`);

const volume = (over: Partial<ComposeMount> = {}): ComposeMount => ({
	serviceName: "api",
	type: "volume",
	volumeName: "api-uploads",
	mountPath: "/app/uploads",
	...over,
});

describe("injectComposeMounts", () => {
	it("returns the spec untouched when there are no mounts", () => {
		const input = spec();
		expect(injectComposeMounts(input, [])).toBe(input);
	});

	it("attaches a named volume to its service and declares it", () => {
		const out = injectComposeMounts(spec(), [volume()]);
		expect(out.services?.api?.volumes).toEqual([
			{ type: "volume", source: "api-uploads", target: "/app/uploads" },
		]);
		expect(out.volumes).toMatchObject({ "api-uploads": null });
	});

	it("keeps a volume definition the file already declares", () => {
		const out = injectComposeMounts(spec(), [
			volume({ serviceName: "cache", volumeName: "cache-data", mountPath: "/backup" }),
		]);
		// The file's own driver must survive — Nixploy only fills in gaps.
		expect(out.volumes).toMatchObject({ "cache-data": { driver: "local" } });
	});

	it("appends to volumes the service already has instead of replacing them", () => {
		const out = injectComposeMounts(spec(), [
			volume({ serviceName: "cache", volumeName: "extra", mountPath: "/extra" }),
		]);
		expect(out.services?.cache?.volumes).toEqual([
			"cache-data:/data",
			{ type: "volume", source: "extra", target: "/extra" },
		]);
	});

	it("renders bind and file mounts as host binds", () => {
		const out = injectComposeMounts(spec(), [
			volume({ type: "bind", volumeName: null, hostPath: "/srv/data", mountPath: "/data" }),
			volume({
				type: "file",
				volumeName: null,
				hostPath: "/etc/nixploy/files/stack/nginx.conf",
				mountPath: "/etc/nginx/nginx.conf",
			}),
		]);
		expect(out.services?.api?.volumes).toEqual([
			{ type: "bind", source: "/srv/data", target: "/data" },
			{
				type: "bind",
				source: "/etc/nixploy/files/stack/nginx.conf",
				target: "/etc/nginx/nginx.conf",
			},
		]);
		// A bind mount declares no named volume.
		expect(out.volumes).toEqual({ "cache-data": { driver: "local" } });
	});

	it("follows the rename an isolated stack applies to its services", () => {
		// An isolated stack has already suffixed every service by the time the
		// mounts are injected, while the row still names the raw service.
		const renamed = parseComposeFile("services:\n  api-ab12:\n    image: api:latest\n");
		const out = injectComposeMounts(renamed, [volume()], (name) => `${name}-ab12`);
		expect(out.services?.["api-ab12"]?.volumes).toEqual([
			{ type: "volume", source: "api-uploads", target: "/app/uploads" },
		]);
	});

	it("drops a mount whose service is not in the file instead of failing the deploy", () => {
		const out = injectComposeMounts(spec(), [volume({ serviceName: "gone" })]);
		expect(out).toEqual(spec());
	});

	it("drops a row with nothing to mount from", () => {
		const out = injectComposeMounts(spec(), [
			volume({ volumeName: null }),
			volume({ type: "bind", volumeName: null, hostPath: null }),
		]);
		expect(out).toEqual(spec());
	});
});
