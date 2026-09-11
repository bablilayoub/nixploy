import { afterEach, describe, expect, it } from "vitest";
import {
	assertSafeGitRef,
	assertSafeOutboundUrl,
	assertSafeSmtpHostname,
	classifyIpAddress,
	isOverlayServiceName,
	redactSensitiveText,
	setPrivateEgressAllowedForTests,
} from "./public-url";

afterEach(() => {
	setPrivateEgressAllowedForTests(null);
});

describe("classifyIpAddress", () => {
	it("classifies the IPv4 ranges the audit called out", () => {
		expect(classifyIpAddress("93.184.216.34")).toBe("public");
		expect(classifyIpAddress("10.0.0.5")).toBe("overlay");
		expect(classifyIpAddress("127.0.0.1")).toBe("private");
		expect(classifyIpAddress("172.20.1.1")).toBe("private");
		expect(classifyIpAddress("192.168.1.1")).toBe("private");
		expect(classifyIpAddress("100.64.0.1")).toBe("private");
		expect(classifyIpAddress("169.254.169.254")).toBe("blocked");
		expect(classifyIpAddress("0.0.0.0")).toBe("blocked");
	});

	it("blocks the ranges the old deny list missed", () => {
		expect(classifyIpAddress("192.0.0.1")).toBe("blocked");
		expect(classifyIpAddress("192.0.2.10")).toBe("blocked");
		expect(classifyIpAddress("198.18.0.1")).toBe("blocked");
		expect(classifyIpAddress("198.19.255.255")).toBe("blocked");
		expect(classifyIpAddress("198.51.100.1")).toBe("blocked");
		expect(classifyIpAddress("203.0.113.1")).toBe("blocked");
		expect(classifyIpAddress("224.0.0.1")).toBe("blocked");
		expect(classifyIpAddress("240.0.0.1")).toBe("blocked");
		expect(classifyIpAddress("255.255.255.255")).toBe("blocked");
	});

	it("canonicalises and classifies IPv6", () => {
		expect(classifyIpAddress("2606:4700:4700::1111")).toBe("public");
		expect(classifyIpAddress("::1")).toBe("private");
		expect(classifyIpAddress("0:0:0:0:0:0:0:1")).toBe("private");
		expect(classifyIpAddress("fd00::1")).toBe("private");
		expect(classifyIpAddress("fc00::1")).toBe("private");
		expect(classifyIpAddress("fe80::1")).toBe("blocked");
		expect(classifyIpAddress("ff02::1")).toBe("blocked");
		expect(classifyIpAddress("2001:db8::1")).toBe("blocked");
		expect(classifyIpAddress("2002::1")).toBe("blocked");
		expect(classifyIpAddress("::")).toBe("blocked");
	});

	it("follows IPv4-mapped and NAT64 addresses through to the embedded v4", () => {
		expect(classifyIpAddress("::ffff:10.0.0.5")).toBe("overlay");
		expect(classifyIpAddress("::ffff:127.0.0.1")).toBe("private");
		expect(classifyIpAddress("::ffff:8.8.8.8")).toBe("public");
		expect(classifyIpAddress("64:ff9b::169.254.169.254")).toBe("blocked");
	});

	it("treats unparseable input as blocked", () => {
		expect(classifyIpAddress("not-an-ip")).toBe("blocked");
		expect(classifyIpAddress("1:2:3::4::5")).toBe("blocked");
	});
});

describe("isOverlayServiceName", () => {
	it("accepts bare service labels and refuses platform names", () => {
		expect(isOverlayServiceName("my-gotify")).toBe(true);
		expect(isOverlayServiceName("nixploy")).toBe(false);
		expect(isOverlayServiceName("nixploy-postgres")).toBe(false);
		expect(isOverlayServiceName("localhost")).toBe(false);
		expect(isOverlayServiceName("example.com")).toBe(false);
		expect(isOverlayServiceName("10.0.0.5")).toBe(false);
	});
});

describe("assertSafeOutboundUrl", () => {
	it("refuses a private literal when private egress is off", async () => {
		setPrivateEgressAllowedForTests(false);
		await expect(
			assertSafeOutboundUrl("http://192.168.1.10/", { allowPrivate: true, allowHttp: true }),
		).rejects.toThrow(/not allowed/);
	});

	it("accepts a private literal once the instance admin turns egress on", async () => {
		setPrivateEgressAllowedForTests(true);
		const target = await assertSafeOutboundUrl("http://192.168.1.10/", {
			allowPrivate: true,
			allowHttp: true,
		});
		expect(target.addresses).toEqual(["192.168.1.10"]);
		expect(target.isPrivate).toBe(true);
	});

	it("never allows the Swarm overlay as a literal, toggle or not", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(
			assertSafeOutboundUrl("http://10.0.0.5/", { allowPrivate: true, allowHttp: true }),
		).rejects.toThrow(/cluster-internal/);
	});

	it("never allows link-local / metadata", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(
			assertSafeOutboundUrl("http://169.254.169.254/latest/meta-data", {
				allowPrivate: true,
				allowHttp: true,
			}),
		).rejects.toThrow(/not allowed/);
	});

	it("refuses platform hostnames", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(
			assertSafeOutboundUrl("http://nixploy-postgres:5432/", {
				allowPrivate: true,
				allowHttp: true,
			}),
		).rejects.toThrow(/platform host/);
	});

	it("requires https unless the call site allows http", async () => {
		setPrivateEgressAllowedForTests(false);
		await expect(assertSafeOutboundUrl("http://example.com/")).rejects.toThrow(/must be https/);
	});

	it("rejects a malformed URL", async () => {
		await expect(assertSafeOutboundUrl("not a url")).rejects.toThrow(/Invalid URL/);
	});
});

describe("assertSafeSmtpHostname", () => {
	it("canonicalises an uncompressed IPv6 loopback literal", async () => {
		setPrivateEgressAllowedForTests(false);
		await expect(assertSafeSmtpHostname("0:0:0:0:0:0:0:1")).rejects.toThrow(/not allowed/);
	});

	it("refuses the overlay range as a literal", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(assertSafeSmtpHostname("10.0.0.5")).rejects.toThrow(/cluster-internal/);
	});

	it("rejects junk", async () => {
		await expect(assertSafeSmtpHostname("smtp host/x")).rejects.toThrow(/Invalid SMTP/);
	});
});

describe("assertSafeGitRef", () => {
	it("accepts ordinary branches and full refs", () => {
		expect(assertSafeGitRef("main")).toBe("main");
		expect(assertSafeGitRef("refs/pull/12/head")).toBe("refs/pull/12/head");
		expect(assertSafeGitRef("release/v1.2.3")).toBe("release/v1.2.3");
	});

	it("rejects option-looking and malformed refs", () => {
		expect(() => assertSafeGitRef("--upload-pack=/bin/sh")).toThrow(/Invalid branch/);
		expect(() => assertSafeGitRef("a..b")).toThrow(/Invalid branch/);
		expect(() => assertSafeGitRef("main@{1}")).toThrow(/Invalid branch/);
		expect(() => assertSafeGitRef("main.lock")).toThrow(/Invalid branch/);
		expect(() => assertSafeGitRef("a b")).toThrow(/Invalid branch/);
	});
});

describe("redactSensitiveText", () => {
	it("scrubs the token families the audit listed", () => {
		expect(redactSensitiveText("token=AKIAIOSFODNN7EXAMPLE done")).toBe("token=*** done");
		expect(redactSensitiveText("key sk-ant-api03-abcdefgh12345678")).toBe("key ***");
		expect(redactSensitiveText("bot xoxb-1234567890-abcdefg")).toBe("bot ***");
		expect(redactSensitiveText("auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghij")).toBe(
			"auth ***",
		);
		expect(redactSensitiveText("gh ghp_abcdefghijklmnop")).toBe("gh ***");
	});

	it("still scrubs URL credentials and explicit secrets", () => {
		expect(redactSensitiveText("https://user:pass@example.com/x")).toBe(
			"https://***:***@example.com/x",
		);
		expect(redactSensitiveText("value hunter2", ["hunter2"])).toBe("value **********");
	});
});
