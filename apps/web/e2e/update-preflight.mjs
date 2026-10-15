import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../tools/screenshots/package.json", import.meta.url));
const { chromium } = require("playwright-core");

// Install the existing tools/screenshots dependencies with npm ci, then run against
// an authenticated disposable panel:
// NIXPLOY_URL=http://localhost:3112 STORAGE_STATE=/private/path/admin.json \
// OUT_DIR=/tmp/update-preflight node apps/web/e2e/update-preflight.mjs
// Update procedures are intercepted; no real update or settings mutation is sent.
const base = process.env.NIXPLOY_URL;
const storageState = process.env.STORAGE_STATE;
const dir = process.env.OUT_DIR;
if (!base || !storageState || !dir)
	throw new Error("NIXPLOY_URL, STORAGE_STATE and OUT_DIR are required");
await fs.mkdir(`${dir}/screenshots`, { recursive: true });
const browser = await chromium.launch({ headless: true });
const result = (data) => ({ result: { data: { json: data } } });
const failure = (path, message = "Preflight fixture unavailable", code = "FORBIDDEN") => ({
	error: {
		json: {
			message,
			code: -32603,
			data: { code, httpStatus: code === "FORBIDDEN" ? 403 : 400, path },
		},
	},
});
const report = { themes: {}, console: [], pageErrors: [] };
try {
	for (const theme of ["light", "dark"]) {
		const ctx = await browser.newContext({
			baseURL: base,
			storageState,
			viewport: { width: 1440, height: 1000 },
			colorScheme: theme,
		});
		await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
		let mode = "delay",
			delay = 1000,
			actionMode = "error",
			statusProgress = false,
			actions = [],
			pendingRelease;
		const fixtureStatus = {
			appVersion: "0.7.3",
			autoCheckEnabled: true,
			autoUpdateEnabled: false,
			checkCron: "17 */6 * * *",
			image: "ghcr.io/bablilayoub/nixploy:main",
			targetImage: "ghcr.io/bablilayoub/nixploy:main",
			lastCheckedAt: new Date().toISOString(),
			lastUpdateAt: null,
			lastError: null,
			updateInProgress: false,
			latestDigest: "sha256:new",
			currentDigest: "sha256:old",
			updateAvailable: true,
			pinnedVersion: null,
			releaseTag: "v0.7.3",
			releaseNotes: "A controlled verification release.\n\nManual step: review the backup warning.",
			releaseUrl: "https://github.com/bablilayoub/nixploy/releases/tag/v0.7.3",
			defaultImage: "ghcr.io/bablilayoub/nixploy:latest",
			defaultCheckCron: "17 */6 * * *",
		};
		await ctx.route("**/api/trpc/**", async (route) => {
			const req = route.request(),
				u = new URL(req.url()),
				names = decodeURIComponent(u.pathname.split("/api/trpc/")[1]).split(",");
			if (!names.some((n) => n.startsWith("updates."))) return route.continue();
			const input =
				req.method() === "POST"
					? req.postDataJSON()
					: JSON.parse(u.searchParams.get("input") ?? "{}");
			let original;
			const entries = [];
			for (let i = 0; i < names.length; i++) {
				const name = names[i],
					args = (u.searchParams.has("batch") ? input[i] : input)?.json ?? {};
				if (name === "updates.getStatus")
					entries.push(result({ ...fixtureStatus, updateInProgress: statusProgress }));
				else if (name === "updates.preflight") {
					if (mode === "delay") await new Promise((r) => setTimeout(r, delay));
					if (mode === "error") {
						entries.push(failure(name));
						continue;
					}
					const checks = [
						{
							id: "backup",
							level: "warn",
							title: "No instance backup has ever succeeded",
							detail: "The database dump does not cover volumes.",
						},
					];
					if (mode === "block")
						checks.push({
							id: "disk",
							level: "block",
							title: "0.5 GiB free on the config filesystem",
							detail: "Free at least 1 GiB before updating.",
						});
					if (args.version === "0.7.2")
						checks.push({
							id: "downgrade",
							level: args.allowDowngrade ? "warn" : "block",
							title: "v0.7.2 is older than the running v0.7.3",
							detail: "Database migrations are never reversed.",
						});
					const blocks = checks.filter((c) => c.level === "block").length;
					entries.push(
						result({
							image:
								mode === "stale"
									? "ghcr.io/bablilayoub/nixploy:old"
									: args.version
										? `ghcr.io/bablilayoub/nixploy:v${args.version.replace(/^v/, "").split(".").map(Number).join(".")}`
										: fixtureStatus.targetImage,
							currentVersion: "0.7.3",
							targetVersion: args.version ?? null,
							ok: blocks === 0,
							blocks,
							warnings: checks.filter((c) => c.level === "warn").length,
							checks,
							checkedAt: new Date().toISOString(),
						}),
					);
				} else if (name === "updates.runUpdate") {
					actions.push(args);
					if (actionMode === "pending")
						await new Promise((resolve) => {
							pendingRelease = resolve;
						});
					if (actionMode === "blocked")
						entries.push(
							result({
								started: false,
								image: fixtureStatus.targetImage,
								message: "Deployments running",
								blockedByDeployments: true,
								activeDeployments: 2,
							}),
						);
					else if (actionMode === "success")
						entries.push(
							result({
								started: true,
								image: fixtureStatus.targetImage,
								message: "Controlled update fixture started",
							}),
						);
					else
						entries.push(
							failure(
								name,
								"The pre-update database dump failed. Check storage, then try again.",
								"PRECONDITION_FAILED",
							),
						);
				} else if (name === "updates.banner")
					entries.push(
						result({ appVersion: "0.7.3", updateAvailable: true, canManageUpdate: true }),
					);
				else if (name === "updates.check") entries.push(result({ updateAvailable: true }));
				else if (name === "updates.updateSettings") entries.push(result(fixtureStatus));
				else {
					original ??= await (await route.fetch()).json();
					entries.push(Array.isArray(original) ? original[i] : original);
				}
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(u.searchParams.has("batch") ? entries : entries[0]),
			});
		});
		const page = await ctx.newPage();
		page.on("console", (m) => {
			if (m.type() === "error") report.console.push({ theme, text: m.text() });
		});
		page.on("pageerror", (e) => report.pageErrors.push({ theme, text: e.message }));
		await page.goto("/dashboard/settings/server", { waitUntil: "networkidle" });
		const updates = page.locator("#updates");
		await updates.scrollIntoViewIfNeeded();
		await updates.getByRole("button", { name: "Show", exact: true }).click();
		assert.match(await updates.innerText(), /Manual step: review the backup warning/);
		assert.equal(
			await updates.getByRole("link", { name: "GitHub", exact: true }).getAttribute("href"),
			fixtureStatus.releaseUrl,
		);
		await page.screenshot({ path: `${dir}/screenshots/${theme}-updates-card.png` });
		await updates.getByRole("button", { name: "Update", exact: true }).click();
		const dialog = page.getByRole("alertdialog");
		const confirm = () => dialog.getByRole("button", { name: "Update now", exact: true });
		await dialog.getByText("Checking the host…", { exact: true }).waitFor();
		assert.equal(await confirm().isEnabled(), false);
		await page.screenshot({ path: `${dir}/screenshots/${theme}-preflight-loading.png` });
		await dialog.getByText("Ready, 1 warning", { exact: true }).waitFor();
		assert.equal(await confirm().isEnabled(), true);
		await page.screenshot({ path: `${dir}/screenshots/${theme}-preflight-warnings.png` });
		mode = "delay";
		delay = 1200;
		await dialog.getByRole("button", { name: "Re-check", exact: true }).click();
		await dialog.getByText("Checking the host…", { exact: true }).waitFor();
		assert.equal(await confirm().isEnabled(), false);
		await dialog.getByText("Ready, 1 warning", { exact: true }).waitFor();
		mode = "error";
		await dialog.getByRole("button", { name: "Re-check", exact: true }).click();
		await dialog.getByText("Preflight unavailable", { exact: true }).waitFor();
		assert.equal(await confirm().isEnabled(), false);
		assert.equal(await dialog.getByText("Ready, 1 warning", { exact: true }).count(), 0);
		await page.screenshot({ path: `${dir}/screenshots/${theme}-preflight-error.png` });
		mode = "block";
		await dialog.getByRole("button", { name: "Re-check", exact: true }).click();
		await dialog.getByText("1 check block this update", { exact: true }).waitFor();
		assert.equal(await confirm().isEnabled(), false);
		await page.screenshot({ path: `${dir}/screenshots/${theme}-preflight-block.png` });
		mode = "stale";
		await dialog.getByRole("button", { name: "Re-check", exact: true }).click();
		await dialog.getByText(/The update target changed/).waitFor();
		assert.equal(await confirm().isEnabled(), false);
		mode = "ok";
		await dialog.getByRole("button", { name: "Re-check", exact: true }).click();
		await dialog.getByText("Ready, 1 warning", { exact: true }).waitFor();
		assert.equal(await confirm().isEnabled(), true);
		actionMode = "pending";
		await confirm().click();
		await page.waitForTimeout(150);
		assert.equal(actions.length, 1);
		assert.equal(await confirm().isEnabled(), false);
		assert.equal(
			await dialog.getByRole("button", { name: "Cancel", exact: true }).isEnabled(),
			false,
		);
		await page.keyboard.press("Escape");
		assert.equal(await dialog.count(), 1);
		actionMode = "error";
		pendingRelease();
		await dialog
			.getByText("The pre-update database dump failed. Check storage, then try again.", {
				exact: true,
			})
			.waitFor();
		assert.equal(await confirm().isEnabled(), true);
		await page.screenshot({ path: `${dir}/screenshots/${theme}-update-failure.png` });
		actionMode = "success";
		await confirm().click();
		await dialog.waitFor({ state: "hidden" });
		assert.equal(actions.length, 2);
		// The backend accepts zero-padded components and resolves their numeric tag.
		await page.locator("#target-version").fill("0.07.3");
		await updates.getByRole("button", { name: "Update to 0.07.3", exact: true }).click();
		await dialog.getByRole("heading", { name: "Update to v0.7.3?", exact: true }).waitFor();
		await dialog.getByText("Ready, 1 warning", { exact: true }).waitFor();
		assert.equal(await confirm().isEnabled(), true);
		assert.match(await dialog.innerText(), /ghcr.io\/bablilayoub\/nixploy:v0\.7\.3/);
		const canonicalRecheck = page.waitForResponse((response) =>
			response.url().includes("updates.preflight"),
		);
		await dialog.getByRole("button", { name: "Re-check", exact: true }).click();
		await canonicalRecheck;
		await dialog.getByText("Ready, 1 warning", { exact: true }).waitFor();
		assert.equal(await confirm().isEnabled(), true);
		await page.screenshot({ path: `${dir}/screenshots/${theme}-canonical-version.png` });
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
		await page.locator("#target-version").fill("0.7.2");
		const beforeVersion = actions.length;
		await updates.getByRole("button", { name: "Update to 0.7.2", exact: true }).click();
		await dialog.getByRole("heading", { name: "Update to v0.7.2?", exact: true }).waitFor();
		await dialog.getByText("1 check block this update", { exact: true }).waitFor();
		assert.equal(actions.length, beforeVersion);
		assert.equal(await confirm().isEnabled(), false);
		assert.match(await dialog.innerText(), /ghcr.io\/bablilayoub\/nixploy:v0.7.2/);
		await dialog
			.getByRole("switch", { name: "I understand database migrations are never reversed." })
			.click();
		await dialog.getByText("Ready, 2 warnings", { exact: true }).waitFor();
		assert.equal(await confirm().isEnabled(), true);
		await page.screenshot({ path: `${dir}/screenshots/${theme}-downgrade-confirm.png` });
		actionMode = "blocked";
		await confirm().click();
		await page.getByRole("heading", { name: "Deployments are running", exact: true }).waitFor();
		const selected = actions.at(-1);
		assert.equal(selected.version, "0.7.2");
		assert.equal(selected.allowDowngrade, true);
		actionMode = "pending";
		await page.getByRole("button", { name: "Update anyway", exact: true }).click();
		await page.waitForTimeout(150);
		assert.equal(await confirm().isEnabled(), false);
		assert.equal(
			await dialog.getByRole("button", { name: "Cancel", exact: true }).isEnabled(),
			false,
		);
		actionMode = "error";
		pendingRelease();
		await page
			.getByRole("alertdialog")
			.getByText("The pre-update database dump failed. Check storage, then try again.", {
				exact: true,
			})
			.waitFor();
		assert.deepEqual(actions.at(-1), { version: "0.7.2", allowDowngrade: true, force: true });
		assert.equal(await confirm().isEnabled(), true);
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		// Server in-progress state locks actions and settings after the status poll.
		statusProgress = true;
		await updates.getByRole("button", { name: "Check", exact: true }).click();
		await updates.getByText("Updating…", { exact: true }).waitFor();
		assert.equal(
			await updates.getByRole("button", { name: "Update", exact: true }).isEnabled(),
			false,
		);
		assert.equal(await page.locator("#target-version").isEnabled(), false);
		assert.equal(await page.locator("#auto-check").isEnabled(), false);
		assert.equal(await page.locator("#auto-update").isEnabled(), false);
		report.themes[theme] = {
			passed: true,
			actions: actions.length,
			checks: [
				"loading",
				"release details",
				"warnings",
				"recheck gating",
				"error with cached data",
				"block",
				"stale target",
				"recovery",
				"pending and Escape gating",
				"failure retry",
				"version confirmation",
				"zero-padded version canonicalization",
				"downgrade acknowledgement",
				"deployment force keeps version and acknowledgement",
				"force pending and error recovery",
				"in-progress gating",
			],
		};
		await ctx.close();
	}
	assert.deepEqual(report.console, [], "Browser console must be clean");
	assert.deepEqual(report.pageErrors, [], "Browser runtime must be clean");
	await fs.writeFile(`${dir}/browser-report.json`, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
} finally {
	await browser.close();
}
