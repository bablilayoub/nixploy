/**
 * Minimal Playwright smoke: setup (or login) → create project → create
 * docker-image application → open Domains tab.
 *
 * NOTE: CI runs `tools/e2e-ui.mjs` instead — same flow, but with real
 * assertions (deployment reaches "Succeeded", the domain dialog creates a row),
 * a light/dark console check and teardown. This file stays as the tolerant
 * "does the panel respond at all" probe; prefer the tools/ script for anything
 * that has to fail when the product is broken.
 *
 * Prerequisites:
 *   - Dev server running at BASE_URL (default http://localhost:3000)
 *   - `pnpm add -Dw playwright-core` once (not bundled — workspace deps are fixed)
 *   - Chromium: `npx playwright-core install chromium`
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node apps/web/e2e/smoke.mjs
 *
 * Optional env:
 *   SMOKE_EMAIL / SMOKE_PASSWORD — reuse an existing account (skips /setup)
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const email = process.env.SMOKE_EMAIL ?? `smoke-${Date.now()}@example.com`;
const password = process.env.SMOKE_PASSWORD ?? "SmokeTest1!";
const name = process.env.SMOKE_NAME ?? "Smoke Tester";
const skipSetup = Boolean(process.env.SMOKE_EMAIL);

async function main() {
	let chromium;
	try {
		({ chromium } = await import("playwright-core"));
	} catch {
		console.error(
			"playwright-core is not installed. Run: pnpm add -Dw playwright-core && npx playwright-core install chromium",
		);
		process.exit(1);
	}

	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (err) => errors.push(String(err)));

	try {
		if (!skipSetup) {
			await page.goto(`${BASE_URL}/setup`);
			await page.getByLabel(/^name$/i).fill(name);
			await page.getByLabel(/email/i).fill(email);
			await page.locator('input[type="password"]').first().fill(password);
			const confirm = page.locator('input[type="password"]').nth(1);
			if (await confirm.count()) await confirm.fill(password);
			await page.getByRole("button", { name: /create owner|setting up/i }).click();
			await page.waitForURL(/dashboard|projects/i, { timeout: 30_000 });
		} else {
			await page.goto(`${BASE_URL}/login`);
			await page.getByLabel(/email/i).fill(email);
			await page.locator('input[type="password"]').fill(password);
			await page.getByRole("button", { name: /sign in|log in/i }).click();
			await page.waitForURL(/dashboard|projects/i, { timeout: 30_000 });
		}

		const createProject = page.getByRole("button", {
			name: /new project|create project|add project/i,
		});
		if (await createProject.count()) {
			await createProject.first().click();
			const nameInput = page.getByLabel(/name/i).first();
			await nameInput.fill(`smoke-${Date.now()}`);
			await page
				.getByRole("button", { name: /create|save|add/i })
				.last()
				.click();
			await page.waitForTimeout(1000);
		}

		const projectLink = page.locator('a[href*="/dashboard/projects/"]').first();
		if (await projectLink.count()) {
			await projectLink.click();
			await page.waitForLoadState("networkidle");
		}

		const createApp = page.getByRole("button", {
			name: /new application|create application|add application|new service/i,
		});
		if (await createApp.count()) {
			await createApp.first().click();
			const nameField = page.getByLabel(/^name$/i).or(page.getByLabel(/application name/i));
			if (await nameField.count()) {
				await nameField.first().fill(`smoke-app-${Date.now()}`);
			}
			const dockerOption = page.getByText(/docker image/i);
			if (await dockerOption.count()) {
				await dockerOption.first().click();
			}
			const imageField = page.getByLabel(/image/i);
			if (await imageField.count()) {
				await imageField.first().fill("traefik/whoami");
			}
			await page
				.getByRole("button", { name: /create|deploy|save|add/i })
				.last()
				.click();
			await page.waitForTimeout(2000);
		}

		const domainsTab = page.getByRole("tab", { name: /domains/i });
		if (await domainsTab.count()) {
			await domainsTab.click();
			await page.waitForTimeout(500);
		}

		if (errors.length) {
			console.warn("Page errors during smoke:", errors.slice(0, 5));
		}
		console.log("Smoke OK", { email, url: page.url() });
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error("Smoke failed:", error);
	process.exit(1);
});
