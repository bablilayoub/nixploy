import { describe, expect, it } from "vitest";
import { parseComposeFile } from "./parse";
import { assertSafeComposePorts, parseServicePorts } from "./ports";
import { assertSafeComposeSpec } from "./safety";

const withPorts = (ports: string) =>
	parseComposeFile(`services:\n  api:\n    image: api:latest\n    ports:\n${ports}\n`);

describe("parseServicePorts", () => {
	it("reads the short form, with and without a protocol", () => {
		expect(parseServicePorts("api", ["8080:80", "5353:53/udp"])).toEqual([
			{ serviceName: "api", published: 8080, target: 80, protocol: "tcp" },
			{ serviceName: "api", published: 5353, target: 53, protocol: "udp" },
		]);
	});

	it("reads a container-only entry as no host port", () => {
		expect(parseServicePorts("api", ["8080"])).toEqual([
			{ serviceName: "api", published: null, target: 8080, protocol: "tcp" },
		]);
	});

	it("reads the long form", () => {
		expect(
			parseServicePorts("api", [{ target: 80, published: 8080, protocol: "udp", mode: "host" }]),
		).toEqual([{ serviceName: "api", published: 8080, target: 80, protocol: "udp" }]);
	});

	// Swarm publishes on every interface, so honouring a bind address would
	// expose a port the author believed was loopback-only.
	it("refuses a host bind address rather than silently widening it", () => {
		expect(() => parseServicePorts("api", ["127.0.0.1:8080:80"])).toThrow(/binds a host address/);
		expect(() => parseServicePorts("api", [{ target: 80, host_ip: "127.0.0.1" }])).toThrow(
			/host_ip is not supported/,
		);
	});

	it("refuses ranges, which would publish many ports from one entry", () => {
		expect(() => parseServicePorts("api", ["8000-8010:80"])).toThrow(/ranges are not supported/);
	});

	it("refuses nonsense entries", () => {
		expect(() => parseServicePorts("api", ["http:80"])).toThrow(/is not a port number/);
		expect(() => parseServicePorts("api", [{ published: 8080 }])).toThrow(/needs a target/);
		expect(() => parseServicePorts("api", ["8080:80/sctp"])).toThrow(/must be tcp or udp/);
		expect(() => parseServicePorts("api", [["8080:80"]])).toThrow(/string or a mapping/);
		expect(() => parseServicePorts("api", "8080:80")).toThrow(/must be a list/);
	});
});

describe("assertSafeComposePorts", () => {
	it("accepts an unprivileged host port", () => {
		expect(assertSafeComposePorts(withPorts('      - "8080:80"'))).toHaveLength(1);
	});

	it("refuses privileged and platform-owned ports", () => {
		// :443 is the whole reason publishing is opt-in — it fights Traefik.
		expect(() => assertSafeComposePorts(withPorts('      - "443:443"'))).toThrow(
			/privileged or sensitive/,
		);
		expect(() => assertSafeComposePorts(withPorts('      - "80:80"'))).toThrow(
			/privileged or sensitive/,
		);
		expect(() => assertSafeComposePorts(withPorts('      - "3000:3000"'))).toThrow(
			/reserved by the Nixploy platform/,
		);
	});

	it("refuses two services claiming the same host port", () => {
		const spec = parseComposeFile(`
services:
  api:
    image: api:latest
    ports: ["8080:80"]
  web:
    image: web:latest
    ports: ["8080:80"]
`);
		// Docker would fail this halfway through, after part of the project is
		// already replaced — better to refuse before anything is touched.
		expect(() => assertSafeComposePorts(spec)).toThrow(/published by both "api" and "web"/);
	});

	it("lets the same number through on different protocols", () => {
		const spec = parseComposeFile(`
services:
  api:
    image: api:latest
    ports: ["5353:53/udp", "5353:53/tcp"]
`);
		expect(assertSafeComposePorts(spec)).toHaveLength(2);
	});

	it("ignores container-only entries, which claim no host port", () => {
		const spec = parseComposeFile(`
services:
  api:
    image: api:latest
    ports: ["80"]
  web:
    image: web:latest
    ports: ["80"]
`);
		expect(assertSafeComposePorts(spec)).toHaveLength(2);
	});
});

describe("assertSafeComposeSpec with ports", () => {
	const spec = () => withPorts('      - "8080:80"');

	it("refuses ports by default, naming the switch", () => {
		expect(() => assertSafeComposeSpec(spec())).toThrow(/Publish host ports/);
	});

	it("accepts them once the stack opted in", () => {
		expect(() => assertSafeComposeSpec(spec(), { allowPorts: true })).not.toThrow();
	});

	it("still refuses a dangerous port when opted in", () => {
		expect(() =>
			assertSafeComposeSpec(withPorts('      - "443:443"'), { allowPorts: true }),
		).toThrow(/privileged or sensitive/);
	});
});
