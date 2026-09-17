import { X509Certificate } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../notifications", () => ({ notifyEvent: async () => {} }));
vi.mock("../observability", () => ({ recordIncident: async () => {} }));

import { daysUntil, describeExpiry, parseCertificateExpiry } from "./certificate-expiry";

/**
 * Real self-signed certificates so the parser is exercised for real, embedded
 * rather than minted with `openssl` at run time: the suite is offline by
 * contract, and a fixture generated per run would also make the assertions
 * depend on the host's clock. Both expire in 2126; the intermediate outlives
 * the leaf, which is the case the chain test is about.
 */
const LEAF_PEM = `-----BEGIN CERTIFICATE-----
MIICtjCCAZ4CCQDldWDwGuAsVDANBgkqhkiG9w0BAQsFADAcMRowGAYDVQQDDBFu
aXhwbG95LXRlc3QtbGVhZjAgFw0yNjA5MTcyMTUyMDFaGA8yMTI2MDgyNDIxNTIw
MVowHDEaMBgGA1UEAwwRbml4cGxveS10ZXN0LWxlYWYwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDBHixIn6kRdCNrbK4pPHhJvQjeX5PB9sRg3wHlElz5
XlFnB3g9o9XcdCQs2vL3lnj4mnK8KQ3/CywDykwsRLYxqdBog1QyRkYmczjMUp2W
g3mDov/sXXV4mDIWkgYtF2MF6BBu2/Gbme9z7ySVPev4N5pjn7VdE2HsvY7iCLD1
lXvaJPQyR0YOWKFpEkor749pH4Ecvpg+dcbxOlwkE3R2HWk0tpLoOn1jTYiPJntd
dS6RIjHH4b7A9VyhbuU964sE3w20DDmFLqLFl/iN1+Y0zi/ahCAO+Tr3VPQZUIlH
5QovYcbD1v9uWS28sJbovlVJObnhuv04mg9KJhTzTCTFAgMBAAEwDQYJKoZIhvcN
AQELBQADggEBALKcgI0lsdcG9vJA+c3ls7D3UafeXs1IelxQ6LLbH+fNM5O9X01a
yHpH5iyQ0xPsUr24Wz36taDIVL+dc92gegRJGrFPVFiFa8SPhBmOM84yaJ3o7WXG
AwvJaYLvlIm9yofFpYQtbHkCNEG4u/PUFv8z648pG303GCMrDVrFkwzonGXHbEwl
kwPGG57Gi9qc/71DEgcFdEy1bnd3V+8yxkAx2kmMm2g2lIsWeBFzBvrSVqYUjZ4l
239RHrmhKXH4FoQHviBHmQlyXtthrzh+ZaQk9zwk+k5XjUzRzi69e2xp2V2XE8Do
qHyIbtkUjdYye7RW+HRbnKOqgnBxnInFHu4=
-----END CERTIFICATE-----
`;
const INTERMEDIATE_PEM = `-----BEGIN CERTIFICATE-----
MIICxjCCAa4CCQCVH1LkPp3ImDANBgkqhkiG9w0BAQsFADAkMSIwIAYDVQQDDBlu
aXhwbG95LXRlc3QtaW50ZXJtZWRpYXRlMCAXDTI2MDkxNzIxNTIwMVoYDzIxMjYx
MjAyMjE1MjAxWjAkMSIwIAYDVQQDDBluaXhwbG95LXRlc3QtaW50ZXJtZWRpYXRl
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtzn9Unc7vMo6s2ci8Ocg
IXA4/jARaCdesasAw0vWoDMt80J2xMPqg+ErAimkTrhgH8ZDqmtxJ3fXGqLRh5fC
rd/Ucu92BgxGmIST0kMlLBa+cNZVmq58IFBxidQ1yQTq68hRkEzQg/q1BPGQMN9+
BNatRH28zulCclNYN3bU1Ax6UIbqk61wfvGTaOIr60DHASdmaZr+U1xuuACmmjAj
txwaWYUP5kHbYbjVMg/wu5Sn0TL59BsMT5TAxs+hivqK9WWQrNqc2mCtZhzcSFn8
bN5lbJwBrUw5SaQdW10wPJV043H21oJZEuPMrZCElHAZKYZ1GuLpX8G6aCe55zHF
NQIDAQABMA0GCSqGSIb3DQEBCwUAA4IBAQAiuDm8IBYyhGRmGoVHvk6+YSyoRQnP
QaeHWlJJpyF0GlhfT/HYZKLDiYXNMih1Ftj4SJiDkHwNdbcn3MUjn/TR/8982Rvy
hHFZey87et98/QbNxU/NohflxTN8mGZl/Z6iHVL7pRD08Z9eL4v6uWknhLYRUikU
f3sbEwc5DJp6NMJC5tVrTtBkUt2PsyDpSfOFkrelu6rhwsUQSSgxrpfEIvarreXy
qDO4v4LTomxWS3pvsDDVFg8T3+JhaWwDiTzBHRJKw1BYABYrCvCdvP/mCNJVkn5T
ywA6ZWM9rSP4FH3LkGVqIyGrQpkQ5Ttxn9eyZh2GXCN6nrCfPRW81IML
-----END CERTIFICATE-----
`;
/** `notAfter` of LEAF_PEM, read from the fixture itself rather than hardcoded. */
const LEAF_EXPIRY = new Date(new X509Certificate(LEAF_PEM).validTo);

describe("parseCertificateExpiry", () => {
	it("reads notAfter out of a real PEM", () => {
		expect(parseCertificateExpiry(LEAF_PEM)?.getTime()).toBe(LEAF_EXPIRY.getTime());
	});

	it("reads the LEAF of a chain, not the intermediate that outlives it", () => {
		// Leaf first is the convention `writeCertificateFiles` assumes; reporting
		// the intermediate's date would say a certificate is fine for a century
		// while the one Traefik serves lapses next month.
		const chain = `${LEAF_PEM}${INTERMEDIATE_PEM}`;
		expect(parseCertificateExpiry(chain)?.getTime()).toBe(LEAF_EXPIRY.getTime());
		expect(new X509Certificate(INTERMEDIATE_PEM).validTo).not.toBe(
			new X509Certificate(LEAF_PEM).validTo,
		);
	});

	it("returns null instead of throwing on a blob it cannot read", () => {
		// A chain Node dislikes may still be one Traefik serves happily, so a
		// failure here must never be able to refuse the upload.
		expect(parseCertificateExpiry("")).toBeNull();
		expect(parseCertificateExpiry("not a certificate")).toBeNull();
		expect(
			parseCertificateExpiry("-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----"),
		).toBeNull();
	});
});

describe("daysUntil", () => {
	const now = new Date("2026-09-17T12:00:00.000Z");

	it("counts whole days, and goes negative once it has lapsed", () => {
		expect(daysUntil(new Date("2026-09-27T12:00:00.000Z"), now)).toBe(10);
		expect(daysUntil(new Date("2026-09-17T23:59:00.000Z"), now)).toBe(0);
		expect(daysUntil(new Date("2026-09-14T12:00:00.000Z"), now)).toBe(-3);
	});
});

describe("describeExpiry", () => {
	const now = new Date("2026-09-17T12:00:00.000Z");

	it("counts down while there is time left", () => {
		expect(describeExpiry("wildcard", new Date("2026-09-27T12:00:00.000Z"), now)).toContain(
			"expires in 10 day(s)",
		);
	});

	it("says today on the last day", () => {
		expect(describeExpiry("wildcard", new Date("2026-09-17T23:00:00.000Z"), now)).toContain(
			"expires today",
		);
	});

	it("says what it means once it has lapsed", () => {
		const message = describeExpiry("wildcard", new Date("2026-09-14T12:00:00.000Z"), now);
		expect(message).toContain("expired 3 day(s) ago");
		expect(message).toContain("invalid certificate");
	});
});
