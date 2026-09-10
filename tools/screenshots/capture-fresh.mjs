/**
 * Fresh product screenshots → landing + docs/images for README.
 * Requires web on :3000 and a seeded admin account.
 *
 *   cd tools/screenshots && PLAYWRIGHT_CHROME=... node capture-fresh.mjs
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL ?? "";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "BablilAyoub@2001";
const OUT = join(__dirname, "out");
const LANDING = join(ROOT, "apps/landing/public/screenshots");
const DOCS = join(ROOT, "docs/images");

mkdirSync(OUT, { recursive: true });
mkdirSync(LANDING, { recursive: true });
mkdirSync(DOCS, { recursive: true });

const chrome =
	process.env.PLAYWRIGHT_CHROME ??
	`${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({
	headless: true,
	executablePath: chrome,
});
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	colorScheme: "dark",
});
const page = await context.newPage();

async function forceDark() {
	await page.addInitScript(() => {
		try {
			localStorage.setItem("theme", "dark");
			document.documentElement.classList.add("dark");
			document.documentElement.style.colorScheme = "dark";
		} catch {
			/* ignore */
		}
	});
}

async function shot(name, settle = 1500) {
	await page.waitForTimeout(settle);
	const path = join(OUT, `${name}.png`);
	await page.screenshot({ path, fullPage: false });
	console.log("captured", name);
	return path;
}

await forceDark();

try {
	await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60_000 });
	await page.evaluate(() => {
		document.documentElement.classList.add("dark");
	});
	await shot("01-login", 800);

	await page.getByLabel(/email/i).fill(EMAIL);
	await page.locator('input[type="password"]').first().fill(PASSWORD);
	await page.getByRole("button", { name: /sign in|log in/i }).click();
	await page.waitForURL(/dashboard/i, { timeout: 45_000 });
	await page.waitForLoadState("networkidle");
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await shot("02-dashboard", 2500);

	const projectLink = page.locator('a[href*="/dashboard/projects/"]').first();
	if ((await projectLink.count()) > 0) {
		await projectLink.click();
		await page.waitForLoadState("networkidle");
		await shot("03-project", 2200);

		const serviceLink = page
			.locator(
				'a[href*="/services/application/"], a[href*="/services/postgres/"], a[href*="/services/compose/"]',
			)
			.first();
		if ((await serviceLink.count()) > 0) {
			const href = await serviceLink.getAttribute("href");
			await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
			await shot("04-service", 2000);

			for (const tab of ["Deployments", "Logs", "Monitoring"]) {
				const tabEl = page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") });
				if ((await tabEl.count()) > 0) {
					await tabEl.first().click();
					await shot(`05-tab-${tab.toLowerCase()}`, tab === "Monitoring" ? 4500 : 2000);
				}
			}
		}
	}

	await page.goto(`${BASE}/dashboard/templates`, { waitUntil: "networkidle" });
	await shot("06-templates", 2200);

	await page.goto(`${BASE}/dashboard/docker`, { waitUntil: "networkidle" });
	await shot("07-docker", 2000);
} finally {
	await browser.close();
}

/** Map capture names → landing public filenames (keep existing URLs). */
const landingMap = {
	"02-dashboard.png": "02-dashboard.png",
	"03-project.png": "03-project.png",
	"05-tab-deployments.png": "05-tab-deployments.png",
	"05-tab-logs.png": "05-tab-logs.png",
	"05-tab-monitoring.png": "05-tab-monitoring.png",
	"06-templates.png": "06-templates.png",
};

for (const [src, dest] of Object.entries(landingMap)) {
	const from = join(OUT, src);
	try {
		copyFileSync(from, join(LANDING, dest));
		console.log("landing", dest);
	} catch (e) {
		console.warn("skip landing", dest, e.message);
	}
}

/** README / docs gallery */
const docsMap = {
	"02-dashboard.png": "dashboard.png",
	"03-project.png": "project.png",
	"05-tab-monitoring.png": "monitoring.png",
	"06-templates.png": "templates.png",
	"07-docker.png": "docker.png",
};

for (const [src, dest] of Object.entries(docsMap)) {
	const from = join(OUT, src);
	try {
		copyFileSync(from, join(DOCS, dest));
		console.log("docs", dest);
	} catch (e) {
		console.warn("skip docs", dest, e.message);
	}
}

console.log("done");
