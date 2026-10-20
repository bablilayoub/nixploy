import { createHmac, timingSafeEqual } from "node:crypto";
import { signingKeys } from "../../lib/encryption";

const canonical = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, canonical(entry)]),
		);
	}
	return value;
};

export function configurationFingerprint(value: unknown): string {
	return createHmac("sha256", signingKeys("nixploy-configuration-release")[0] as Buffer)
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}

export function matchesConfigurationReview(expected: string, supplied: string): boolean {
	if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
	return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}
