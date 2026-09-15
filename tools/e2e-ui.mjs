#!/usr/bin/env node
/**
 * Playwright golden path through the panel UI.
 *
 *   /setup (or /login) → dashboard → New project → Add service ▸ Application
 *   → source = Docker image (traefik/whoami) → Deploy → "Succeeded"
 *   → Domains ▸ Add domain dialog → create a *.traefik.me domain
 *   → repeat the surfaces in light and dark, asserting a clean console
 *
 * Deliberately small: the REST golden path (`tools/golden-path-api.mjs`) is
 * what proves the deploy engine, Traefik routing, backups and teardown. This
 * one only proves the UI can drive the same flow and does not throw in either
 * theme — the two failure modes a headless API test cannot see.
 *
 * Browser resolution, in order:
 *   1. `playwright`      — what `npx playwright@1.x` provides in CI
 *   2. `playwright-core` — if someone added it to the workspace
 *   3. `tools/screenshots/node_modules/playwright-core` — the local checkout's
 *      existing screenshot tooling, so a dev needs no extra install
 *
 * CI installs a pinned Playwright into a scratch prefix and points NODE_PATH at
 * it (so the pnpm workspace's dependency set stays untouched):
 *   npm install --prefix "$RUNNER_TEMP/pw" playwright@1.62.1
 *   "$RUNNER_TEMP/pw/node_modules/.bin/playwright" install --with-deps chromium
 *   NODE_PATH="$RUNNER_TEMP/pw/node_modules" BASE_URL=http://localhost:3000 \
 *     node tools/e2e-ui.mjs
 *
 * Env:
 *   BASE_URL          panel origin, default http://localhost:3000
 *   E2E_EMAIL         account to create at /setup or sign in with
 *   E2E_PASSWORD      its password (must satisfy the password policy)
 *   E2E_ORG           organization name used by the setup wizard
 *   E2E_DOMAIN_SUFFIX default "traefik.me"
 *   E2E_HEADED=1      run headed (local debugging)
 *   E2E_SHOTS=<dir>   write a screenshot per milestone
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const STAMP = Date.now().toString(36);
const EMAIL = process.env.E2E_EMAIL ?? `ui-${STAMP}@example.test`;
const PASSWORD = process.env.E2E_PASSWORD ?? "Ui-e2e-password!1";
const ORG = process.env.E2E_ORG ?? "E2E Org";
const DOMAIN_SUFFIX = process.env.E2E_DOMAIN_SUFFIX ?? "traefik.me";
const SHOTS = process.env.E2E_SHOTS ?? "";
const HEADED = process.env.E2E_HEADED === "1";

/** Kept in step with tools/screenshots/package.json and the CI e2e job. */
const PINNED_PLAYWRIGHT = "1.62.1";

/**
 * Console noise that is not a product bug. Keep this list short and explain
 * every entry — it is the only thing standing between "clean console" and a
 * meaningless assertion.
 */
const IGNORED_CONSOLE = [
	// The dev/prod WebSocket reconnects while a page is being torn down.
	/websocket/i,
	// Chromium logs a failed favicon fetch as a console error on some pages.
	/favicon/i,
	// React DevTools suggestion banner.
	/Download the React DevTools/i,
	// The runner's network moved under the browser mid-request. Chrome reports
	// it as a console error on whatever page was loading; it says nothing about
	// the panel, and failing the whole run on it makes the assertion noise.
	/net::ERR_(NETWORK_CHANGED|INTERNET_DISCONNECTED|NETWORK_IO_SUSPENDED|NAME_NOT_RESOLVED)/,
];

let stepNumber = 0;
const started = Date.now();
const problems = [];

const step = (title) => {
	stepNumber += 1;
	console.log(`\n── ${stepNumber}. ${title}`);
};
const ok = (message) => console.log(`   ✓ ${message}`);
const info = (message) => console.log(`   · ${message}`);
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

async function loadChromium() {
	const candidates = [
		"playwright",
		"playwright-core",
		// `index.mjs`, not `index.js`: the CJS entry does not re-export
		// `chromium` as a named ESM binding.
		join(repoRoot, "tools/screenshots/node_modules/playwright-core/index.mjs"),
	];
	// ESM `import()` ignores NODE_PATH, so bare specifiers are resolved the
	// CommonJS way first (NODE_PATH entries, then the repo) and imported by
	// file URL — that is how the CI scratch install becomes visible.
	const require = createRequire(import.meta.url);
	const searchPaths = [
		...(process.env.NODE_PATH ?? "").split(delimiter).filter(Boolean),
		repoRoot,
	];
	for (const candidate of candidates) {
		if (candidate.startsWith("/") && !existsSync(candidate)) continue;
		try {
			let specifier = candidate;
			if (!candidate.startsWith("/")) {
				try {
					specifier = pathToFileURL(require.resolve(candidate, { paths: searchPaths })).href;
				} catch {
					// not installed anywhere we look — plain import() below decides
				}
			}
			const mod = await import(specifier);
			const chromium = mod.chromium ?? mod.default?.chromium;
			if (chromium) return { chromium, from: candidate };
		} catch {
			// try the next candidate
		}
	}
	console.error(
		"No Playwright available.\n" +
			`  CI:    npm install --prefix "$RUNNER_TEMP/pw" playwright@${PINNED_PLAYWRIGHT}\n` +
			'         "$RUNNER_TEMP/pw/node_modules/.bin/playwright" install --with-deps chromium\n' +
			'         NODE_PATH="$RUNNER_TEMP/pw/node_modules" node tools/e2e-ui.mjs\n' +
			"  Local: (cd tools/screenshots && npm ci && npx playwright-core install chromium)",
	);
	process.exit(1);
}

async function shot(page, name) {
	if (!SHOTS) return;
	await mkdir(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/* -------------------------------------------------------------------------- */

async function main() {
	const { chromium, from } = await loadChromium();
	info(`playwright from ${from}`);

	const browser = await chromium.launch({ headless: !HEADED });
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		ignoreHTTPSErrors: true,
	});
	const page = await context.newPage();

	/** Console + uncaught errors, tagged with the URL they happened on. */
	const record = (kind, text) => {
		if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
		problems.push(`[${kind}] ${page.url()} — ${text}`);
	};
	page.on("console", (message) => {
		if (message.type() === "error") record("console.error", message.text());
	});
	page.on("pageerror", (error) => record("pageerror", String(error)));

	try {
		step("sign in (or run the setup wizard)");
		await page.goto(`${BASE_URL}/setup`, { waitUntil: "domcontentloaded" });
		const onSetup = await page
			.getByRole("heading", { name: /welcome to nixploy/i })
			.isVisible()
			.catch(() => false);

		// Signed-in landing: the dashboard shell renders this control on every
		// dashboard route. Sign-in and the wizard navigate client-side, which
		// never fires a `load` event, so wait for the element, not the URL.
		const dashboardReady = () =>
			page.getByRole("button", { name: "New project" }).first().waitFor({ timeout: 60_000 });

		if (onSetup) {
			// Four steps (`setup-form.tsx`): welcome → owner → org → ready.
			await page.getByRole("button", { name: /^continue$/i }).click();
			await page.getByLabel("Name", { exact: true }).fill("E2E Owner");
			await page.getByLabel("Email").fill(EMAIL);
			await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
			await page.getByLabel(/confirm password/i).fill(PASSWORD);
			const token = process.env.NIXPLOY_SETUP_TOKEN;
			if (token) await page.getByLabel(/setup token/i).fill(token);
			await page.getByRole("button", { name: /^continue$/i }).click();
			await page.getByLabel(/organization name/i).fill(ORG);
			await page.getByRole("button", { name: /^continue$/i }).click();
			await page.getByRole("button", { name: /create instance/i }).click();
			await page.getByRole("button", { name: /open dashboard/i }).click({ timeout: 60_000 });
			await dashboardReady();
			ok(`setup wizard completed as ${EMAIL}`);
		} else {
			await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
			// react-hook-form re-seeds the fields on hydration; a fill that lands
			// before that is silently discarded ("Enter a valid email address").
			await page.waitForTimeout(1500);
			await page.getByLabel(/email/i).fill(EMAIL);
			await page.locator('input[type="password"]').first().fill(PASSWORD);
			await page
				.getByRole("button", { name: /sign in|log in/i })
				.first()
				.click();
			await dashboardReady();
			ok(`signed in as ${EMAIL}`);
		}
		await shot(page, "01-dashboard");

		// Neither create dialog navigates — they close, toast, and refresh the
		// list — so each step opens the new row by its link afterwards.
		step("create a project");
		const projectName = `ui-${STAMP}`;
		await page.getByRole("button", { name: "New project" }).click();
		const projectDialog = page.getByRole("dialog");
		await projectDialog.getByLabel("Name", { exact: true }).fill(projectName);
		await projectDialog.getByRole("button", { name: "Create", exact: true }).click();
		await page.getByText(`Project "${projectName}" created`).waitFor({ timeout: 30_000 });
		// No reload on purpose: on an instance whose project list was empty the
		// row used to appear only on the next load (query-core de-duplicated the
		// invalidation onto the in-flight empty-state request; fixed 2026-09-11
		// in create-project-dialog.tsx). Opening it straight away is the
		// regression check for that fix.
		await page
			.locator('a[href*="/dashboard/projects/"]')
			.filter({ hasText: projectName })
			.first()
			.click();
		await page.waitForURL(/\/dashboard\/projects\/[^/]+$/, { timeout: 60_000 });
		const projectUrl = page.url();
		ok(`project ${projectName} → ${projectUrl}`);
		await shot(page, "02-project");

		step("add an application");
		const appName = `whoami-${STAMP}`;
		await page
			.getByRole("button", { name: /add service/i })
			.first()
			.click();
		await page.getByRole("menuitem", { name: "Application", exact: true }).click();
		const createDialog = page.getByRole("dialog");
		await createDialog.getByLabel("Name", { exact: true }).fill(appName);
		await createDialog.getByRole("button", { name: "Create", exact: true }).click();
		await page.getByText(`Application "${appName}" created`).waitFor({ timeout: 30_000 });
		// Creating a service opens it: the dialog can take the source up front, so
		// the panel navigates on its own. Clicking the row link as well raced with
		// that navigation ("element was detached from the DOM"). Fall back to the
		// link only if the navigation did not happen.
		await page
			.waitForURL(/\/services\/application\/[^/?]+/, { timeout: 30_000 })
			.catch(async () => {
				await page
					.locator('a[href*="/services/application/"]')
					.filter({ hasText: appName })
					.first()
					.click();
				await page.waitForURL(/\/services\/application\/[^/?]+/, { timeout: 60_000 });
			});
		const applicationUrl = page.url().split("?")[0];
		ok(`application ${appName} → ${applicationUrl}`);

		step("set the source to a Docker image");
		await page.getByRole("combobox").first().click();
		// Case-insensitive: the option reads "Docker image" (sentence case).
		await page.getByRole("option", { name: /^docker image$/i }).click();
		// Scoped by id: the closed Select still exposes that option, which
		// getByLabel would also match.
		await page.locator("#docker-image").fill("traefik/whoami:v1.10.1");
		await page.getByRole("button", { name: "Save source" }).click();
		await page.getByText("Source configuration saved").waitFor({ timeout: 30_000 });
		ok("source saved (traefik/whoami:v1.10.1)");
		await shot(page, "03-source");

		step("deploy and wait for Succeeded");
		await page
			.getByRole("button", { name: /^(Deploy|Redeploy)$/ })
			.first()
			.click();
		await page.goto(`${applicationUrl}?tab=deployments`, { waitUntil: "domcontentloaded" });
		await page.getByText("Succeeded", { exact: true }).first().waitFor({ timeout: 300_000 });
		ok("deployment shows Succeeded");
		await shot(page, "04-deployed");

		step("add a domain through the dialog");
		const host = `${appName}.${DOMAIN_SUFFIX}`;
		await page.goto(`${applicationUrl}?tab=domains`, { waitUntil: "domcontentloaded" });
		await page.getByRole("button", { name: "Add domain" }).first().click();
		const domainDialog = page.getByRole("dialog");
		await domainDialog.getByRole("heading", { name: /add domain/i }).waitFor({ timeout: 15_000 });
		await domainDialog.locator("#domain-host").fill(host);
		// Container port has a placeholder, not a default — an empty field is a
		// validation error, not 3000. whoami listens on 80.
		await domainDialog.locator("#domain-port").fill("80");
		await domainDialog.getByRole("button", { name: "Create domain" }).click();
		await page.getByText("Domain created").waitFor({ timeout: 30_000 });
		await page
			.getByRole("link", { name: new RegExp(host) })
			.first()
			.waitFor({ timeout: 30_000 });
		ok(`domain ${host} listed`);
		await shot(page, "05-domain");

		step("light and dark");
		for (const theme of ["light", "dark"]) {
			await page.evaluate((value) => window.localStorage.setItem("theme", value), theme);
			for (const [name, url] of [
				["dashboard", `${BASE_URL}/dashboard`],
				["project", projectUrl],
				["app-general", applicationUrl],
				["app-domains", `${applicationUrl}?tab=domains`],
				["app-deployments", `${applicationUrl}?tab=deployments`],
			]) {
				await page.goto(url, { waitUntil: "domcontentloaded" });
				await page.waitForLoadState("networkidle").catch(() => {});
				const applied = await page.evaluate(() =>
					document.documentElement.classList.contains("dark") ? "dark" : "light",
				);
				if (applied !== theme) {
					problems.push(`[theme] ${url} rendered ${applied} while theme=${theme}`);
				}
				await shot(page, `06-${theme}-${name}`);
			}
			ok(`${theme} mode walked 5 surfaces`);
		}

		step("delete the project (teardown, through the UI)");
		await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
		await page.getByRole("button", { name: "Project settings" }).click();
		await page.getByRole("menuitem", { name: "Delete" }).click();
		const deleteDialog = page.getByRole("alertdialog");
		await deleteDialog.locator("#delete-project-confirm").fill(projectName);
		await deleteDialog.getByRole("button", { name: "Delete project" }).click();
		await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 120_000 });
		ok(`project ${projectName} deleted`);
	} catch (error) {
		// A screenshot of the moment it broke is worth more than the stack.
		await shot(page, "99-failure").catch(() => {});
		const toasts = await page
			.locator("[data-sonner-toast]")
			.allInnerTexts()
			.catch(() => []);
		if (toasts.length > 0) console.error(`   toasts on screen: ${toasts.join(" | ")}`);
		throw error;
	} finally {
		await context.close();
		await browser.close();
	}

	step("console");
	if (problems.length > 0) {
		console.error(`   ✖ ${problems.length} console/theme problem(s):`);
		for (const problem of problems.slice(0, 25)) console.error(`     · ${problem}`);
		throw new Error(`${problems.length} console/theme problem(s)`);
	}
	ok("no console errors, no page errors, both themes applied");

	console.log(`\nUI GOLDEN PATH OK (${elapsed()}) — ${stepNumber} steps`);
}

main().catch((error) => {
	console.error(`\n✖ UI golden path failed at step ${stepNumber}: ${error.message}`);
	process.exit(1);
});
