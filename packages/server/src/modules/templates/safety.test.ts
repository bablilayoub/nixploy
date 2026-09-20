import { describe, expect, it } from "vitest";
import { checkTemplateCompose, templateNeedsInstanceAdmin } from "./safety";
import type { Template } from "./types";

const withPorts = `services:
  app:
    image: nginx
    ports:
      - "8080:80"
`;

const plain = `services:
  app:
    image: nginx
`;

const asTemplate = (
	compose: string,
	hostPrivileged?: boolean,
): Pick<Template, "compose" | "hostPrivileged"> => ({
	compose,
	...(hostPrivileged === undefined ? {} : { hostPrivileged }),
});

describe("checkTemplateCompose", () => {
	it("indexes a file that publishes host ports and flags it", () => {
		expect(checkTemplateCompose(withPorts)).toEqual({ publishPorts: true });
		expect(checkTemplateCompose(plain)).toEqual({ publishPorts: false });
	});

	it("still applies the published-port rules to a file that publishes them", () => {
		// A privileged host port, a range and a bind address are refused even
		// though publishing itself is allowed — the opt-in is not a bypass.
		expect(() =>
			checkTemplateCompose(`services:\n  a:\n    image: x\n    ports:\n      - "53:53/udp"\n`),
		).toThrow(/privileged or sensitive host ports/);
		expect(() =>
			checkTemplateCompose(`services:\n  a:\n    image: x\n    ports:\n      - "8000-8010:80"\n`),
		).toThrow(/port ranges are not supported/);
		expect(() =>
			checkTemplateCompose(
				`services:\n  a:\n    image: x\n    ports:\n      - "127.0.0.1:8080:80"\n`,
			),
		).toThrow(/binds a host address/);
	});

	it("refuses everything the deploy refuses", () => {
		expect(() =>
			checkTemplateCompose(
				`services:\n  a:\n    image: x\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n`,
			),
		).toThrow(/Docker socket/);
		expect(() =>
			checkTemplateCompose(`services:\n  a:\n    image: x\n    privileged: true\n`),
		).toThrow();
		// The docker socket is carried only by a host-privileged (built-in) entry.
		expect(
			checkTemplateCompose(
				`services:\n  a:\n    image: x\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n`,
				{ hostPrivileged: true },
			),
		).toEqual({ publishPorts: false });
	});
});

describe("templateNeedsInstanceAdmin", () => {
	it("is true for host access and for published ports, read from the file", () => {
		expect(templateNeedsInstanceAdmin(asTemplate(plain))).toBe(false);
		expect(templateNeedsInstanceAdmin(asTemplate(withPorts))).toBe(true);
		expect(templateNeedsInstanceAdmin(asTemplate(plain, true))).toBe(true);
	});

	it("does not depend on the cached flag", () => {
		// A source synced by an older build carries no `publishPorts`; the gate
		// must still fire.
		const stale: Template = {
			id: "x",
			name: "x",
			description: "",
			logo: "",
			category: "Custom",
			tags: [],
			links: {},
			compose: withPorts,
			env: [],
			suggestedDomain: { serviceName: "app", port: 80 },
		};
		expect(stale.publishPorts).toBeUndefined();
		expect(templateNeedsInstanceAdmin(stale)).toBe(true);
	});

	it("answers false for a file that does not parse (the deploy fails on it)", () => {
		expect(templateNeedsInstanceAdmin(asTemplate("not: [a compose file"))).toBe(false);
	});
});
