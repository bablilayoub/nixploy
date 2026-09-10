/**
 * Captures product screenshots of the Nixploy dashboard for the landing page.
 * Usage: node capture.mjs  (requires dev server on :3000 and seeded admin account)
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL ?? "";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "";
const OUT = new URL("./out/", import.meta.url).pathname;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
	viewport: { width: 1600, height: 1000 },
	deviceScaleFactor: 2,
});

async function shot(name) {
	await page.waitForTimeout(1200);
	await page.screenshot({ path: `${OUT}${name}.png` });
	console.log("captured", name);
}

try {
	// 1. Login page (logged out)
	await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
	await shot("01-login");

	// 2. Sign in
	await page.getByLabel(/email/i).fill(EMAIL);
	await page.locator('input[type="password"]').first().fill(PASSWORD);
	await page.getByRole("button", { name: /sign in|log in/i }).click();
	await page.waitForURL(/dashboard/i, { timeout: 30_000 });
	await page.waitForLoadState("networkidle");
	await shot("02-dashboard");

	// 3. First project
	const projectLink = page.locator('a[href*="/dashboard/projects/"]').first();
	if (await projectLink.count()) {
		await projectLink.click();
		await page.waitForLoadState("networkidle");
		await shot("03-project");

		// 4. First service inside the project
		const serviceLink = page
			.locator('a[href*="/services/application/"], a[href*="/services/postgres/"]')
			.first();
		if (await serviceLink.count()) {
			const href = await serviceLink.getAttribute("href");
			await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
			await shot("04-service");

			for (const tab of ["Deployments", "Logs", "Monitoring", "Domains", "Advanced"]) {
				const tabEl = page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") });
				if (await tabEl.count()) {
					await tabEl.first().click();
					await page.waitForTimeout(1500);
					await shot(`05-tab-${tab.toLowerCase()}`);
				}
			}
		}
	}

	// 6. Templates
	await page.goto(`${BASE}/dashboard/templates`, { waitUntil: "networkidle" });
	await shot("06-templates");

	// 7. Docker
	await page.goto(`${BASE}/dashboard/docker`, { waitUntil: "networkidle" });
	await shot("07-docker");

	// 8. Settings
	await page.goto(`${BASE}/dashboard/settings/server`, { waitUntil: "networkidle" });
	await shot("08-settings");
} finally {
	await browser.close();
}
console.log("done ->", OUT);
