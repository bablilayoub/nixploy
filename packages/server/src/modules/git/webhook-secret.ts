import { createHmac } from "node:crypto";

/**
 * Dedicated webhook auth secret, derived from ENCRYPTION_KEY + provider id.
 * Never reuse API tokens / app passwords for webhook verification — those
 * credentials would otherwise ride on every Bitbucket/Gitea delivery.
 */
export function derivedWebhookSecret(provider: "bitbucket" | "gitea", providerId: string): string {
	const key = process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
	if (!key) {
		throw new Error("ENCRYPTION_KEY (or BETTER_AUTH_SECRET) is required for webhook secrets");
	}
	return createHmac("sha256", key)
		.update(`nixploy-webhook:${provider}:${providerId}`)
		.digest("hex");
}
