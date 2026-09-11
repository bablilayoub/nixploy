#!/usr/bin/env node
/**
 * Claim a fresh instance and hand back an API key.
 *
 * Exactly the sequence `/setup` performs in the browser, over HTTP:
 *
 *   1. POST /api/auth/sign-up/email        (+ x-nixploy-setup-token when the
 *                                           instance requires one)
 *   2. POST /api/auth/organization/create
 *   3. POST /api/auth/organization/set-active
 *   4. POST /api/auth/api-key/create
 *
 * The first user of an instance is also the instance admin (better-auth admin
 * plugin), which is what lets the golden path create a *local* backup
 * destination.
 *
 * Already-claimed instances are fine: sign-up 4xx falls back to
 * POST /api/auth/sign-in/email with the same credentials, so re-running against
 * a warm panel just mints another key.
 *
 *   NIXPLOY_URL=http://localhost:3000 \
 *   E2E_EMAIL=e2e@nixploy.test E2E_PASSWORD='E2e-ci-password!1' \
 *   node tools/bootstrap-instance.mjs
 *
 * Prints the key on stdout. Under GitHub Actions it also writes
 * `api-key` to $GITHUB_OUTPUT and masks the value in the log.
 */

import { appendFileSync } from "node:fs";

const BASE = (process.env.NIXPLOY_URL ?? process.env.BASE_URL ?? "http://localhost:3000").replace(
	/\/$/,
	"",
);
const EMAIL = process.env.E2E_EMAIL ?? "e2e@nixploy.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "E2e-ci-password!1";
const NAME = process.env.E2E_NAME ?? "E2E Owner";
const ORG = process.env.E2E_ORG ?? "E2E Org";
const KEY_NAME = process.env.E2E_KEY_NAME ?? `e2e-${Date.now().toString(36)}`;

/** Header the setup wizard sends; see modules/auth/setup.ts. */
const SETUP_TOKEN_HEADER = "x-nixploy-setup-token";
const setupToken = process.env.NIXPLOY_SETUP_TOKEN?.trim();

/** better-auth is cookie-based; one jar for the whole sequence. */
const cookies = new Map();

function storeCookies(response) {
	for (const raw of response.headers.getSetCookie?.() ?? []) {
		const [pair] = raw.split(";");
		const index = pair.indexOf("=");
		if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
	}
}

function cookieHeader() {
	return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function call(path, body) {
	const response = await fetch(`${BASE}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			// better-auth checks the origin against BETTER_AUTH_URL.
			origin: BASE,
			...(cookies.size > 0 ? { cookie: cookieHeader() } : {}),
			...(setupToken ? { [SETUP_TOKEN_HEADER]: setupToken } : {}),
		},
		body: JSON.stringify(body),
	});
	storeCookies(response);
	const text = await response.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
	}
	return { ok: response.ok, status: response.status, data, text };
}

function die(message) {
	console.error(`bootstrap-instance: ${message}`);
	process.exit(1);
}

async function main() {
	const signUp = await call("/api/auth/sign-up/email", {
		name: NAME,
		email: EMAIL,
		password: PASSWORD,
	});
	if (signUp.ok) {
		console.error(`created the first admin ${EMAIL}`);
	} else {
		console.error(`sign-up returned ${signUp.status}; trying sign-in instead`);
		const signIn = await call("/api/auth/sign-in/email", { email: EMAIL, password: PASSWORD });
		if (!signIn.ok) {
			die(
				`neither sign-up nor sign-in worked.\n  sign-up: ${signUp.status} ${signUp.text.slice(0, 300)}\n  sign-in: ${signIn.status} ${signIn.text.slice(0, 300)}`,
			);
		}
		console.error(`signed in as ${EMAIL}`);
	}

	// A brand-new owner has no organization; an existing one already does and
	// better-auth answers 4xx for the duplicate slug — both are fine.
	const slug = ORG.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const org = await call("/api/auth/organization/create", { name: ORG, slug });
	const organizationId = org.data?.id;
	if (organizationId) {
		const active = await call("/api/auth/organization/set-active", { organizationId });
		if (!active.ok) die(`set-active failed: ${active.status} ${active.text.slice(0, 300)}`);
		console.error(`organization ${organizationId} is active`);
	} else {
		console.error(`organization not created (${org.status}); assuming one is already active`);
	}

	const key = await call("/api/auth/api-key/create", { name: KEY_NAME });
	const apiKey = key.data?.key;
	if (!key.ok || !apiKey) {
		die(`api-key/create failed: ${key.status} ${key.text.slice(0, 300)}`);
	}

	if (process.env.GITHUB_OUTPUT) {
		// Mask first: anything that reaches a log after this line is redacted.
		console.log(`::add-mask::${apiKey}`);
		appendFileSync(process.env.GITHUB_OUTPUT, `api-key=${apiKey}\n`);
		console.error(`api key ${KEY_NAME} written to $GITHUB_OUTPUT`);
	} else {
		console.log(apiKey);
	}
}

main().catch((error) => die(error.message));
