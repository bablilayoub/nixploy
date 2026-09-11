#!/usr/bin/env node
/**
 * Break-glass account recovery for a self-hosted Nixploy instance.
 *
 *   docker exec nixploy node scripts/reset-admin.mjs <email>
 *
 * Sets a random password on the account, removes its TOTP enrolment and
 * revokes every live session, then prints the one-time password. Use it when
 * the sole instance admin loses their password or authenticator and no email
 * channel is configured for the reset flow.
 *
 * Runs from the shipped image without a build step: `apps/web` is copied whole
 * into the runtime layer (docker/Dockerfile) and WORKDIR is `/app/apps/web`,
 * so both this file and the workspace's node_modules are already there.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// `postgres` and `bcryptjs` are dependencies of @nixploy/server, not of the
// web app, so resolve them from the server package (pnpm's strict layout).
const candidates = [
	new URL("../../../packages/server/package.json", import.meta.url),
	new URL("../../packages/server/package.json", import.meta.url),
];

function serverRequire() {
	for (const candidate of candidates) {
		try {
			const require = createRequire(candidate);
			require.resolve("postgres");
			return require;
		} catch {
			// try the next candidate
		}
	}
	throw new Error(
		`Could not resolve @nixploy/server dependencies from ${candidates
			.map((url) => fileURLToPath(url))
			.join(" or ")}`,
	);
}

const require = serverRequire();
const postgres = require("postgres");
const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 10;

function usage(message) {
	if (message) console.error(`Error: ${message}\n`);
	console.error("Usage: node scripts/reset-admin.mjs <email>");
	console.error("");
	console.error("Resets the password and clears two-factor for one account.");
	process.exit(message ? 1 : 0);
}

/** 24 URL-safe characters — comfortably above the 12-character minimum. */
function generatePassword() {
	return randomBytes(18).toString("base64url");
}

async function main() {
	const email = process.argv[2]?.trim();
	if (!email || email === "--help" || email === "-h") {
		usage(email ? undefined : "an email address is required");
		return;
	}

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		usage("DATABASE_URL is not set (run this inside the nixploy container)");
		return;
	}

	const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
	try {
		const [user] = await sql`
			SELECT id, email, name, role FROM "user" WHERE lower(email) = ${email.toLowerCase()} LIMIT 1
		`;
		if (!user) {
			console.error(`No account found for ${email}`);
			process.exitCode = 1;
			return;
		}

		const password = generatePassword();
		const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

		const [credential] = await sql`
			SELECT id FROM account WHERE user_id = ${user.id} AND provider_id = 'credential' LIMIT 1
		`;
		if (credential) {
			await sql`
				UPDATE account SET password = ${hash}, updated_at = now() WHERE id = ${credential.id}
			`;
		} else {
			// An SSO-only account has no credential row yet — create one so the
			// operator can sign in with a password while the IdP is unavailable.
			await sql`
				INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
				VALUES (${randomUUID()}, ${user.id}, 'credential', ${user.id}, ${hash}, now(), now())
			`;
		}

		const removedTotp = await sql`DELETE FROM two_factor WHERE user_id = ${user.id} RETURNING id`;
		await sql`UPDATE "user" SET two_factor_enabled = false, updated_at = now() WHERE id = ${user.id}`;
		const revoked = await sql`DELETE FROM session WHERE user_id = ${user.id} RETURNING id`;

		console.log("");
		console.log(`Account   ${user.email}${user.name ? ` (${user.name})` : ""}`);
		console.log(`Role      ${user.role ?? "user"}`);
		console.log(`Password  ${password}`);
		console.log("");
		console.log(
			`Two-factor ${removedTotp.length > 0 ? "removed" : "was not enabled"}; ${revoked.length} session(s) revoked.`,
		);
		console.log("Sign in with this password and change it immediately in Settings → Profile.");
		console.log("");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
