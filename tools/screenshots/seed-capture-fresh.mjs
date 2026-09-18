/**
 * Seed a docker-image app + capture service tabs for landing/README.
 * Logs in via better-auth HTTP API (more reliable than form).
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

async function formLogin() {
	await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
	await page.getByLabel(/email/i).fill(EMAIL);
	await page.locator('input[type="password"]').first().fill(PASSWORD);
	await Promise.all([
		page.waitForURL(
			(url) => url.pathname.includes("dashboard") || url.pathname.includes("two-factor"),
			{
				timeout: 60_000,
			},
		),
		page.getByRole("button", { name: "Sign in", exact: true }).click(),
	]);
	if (page.url().includes("two-factor")) {
		throw new Error("two-factor required — disable 2FA for screenshot capture");
	}
	await page.waitForLoadState("networkidle");
	await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ headless: true, executablePath: chrome });
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	colorScheme: "dark",
});
const page = await context.newPage();
await page.addInitScript(() => {
	try {
		localStorage.setItem("theme", "dark");
		document.documentElement.classList.add("dark");
	} catch {
		/* ignore */
	}
});

async function shot(name, settle = 1800) {
	await page.waitForTimeout(settle);
	await page
		.locator("[data-sonner-toast]")
		.evaluateAll((els) => {
			for (const el of els) el.remove();
		})
		.catch(() => {});
	const path = join(OUT, `${name}.png`);
	await page.screenshot({ path });
	console.log("captured", name);
}

try {
	await formLogin();
	await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 60_000 });
	await shot("02-dashboard", 2200);

	const projectHref = await page
		.locator('a[href*="/dashboard/projects/"]')
		.first()
		.getAttribute("href");
	if (!projectHref) throw new Error("no project");
	await page.goto(`${BASE}${projectHref}`, { waitUntil: "networkidle" });

	const appLink = page.locator('a[href*="/services/application/"]').first();
	if ((await appLink.count()) === 0) {
		console.log("creating application…");
		await page
			.getByRole("button", { name: /add service/i })
			.first()
			.click();
		await page.getByRole("menuitem", { name: /application/i }).click();
		const dialog = page.locator('[role="dialog"]');
		await dialog.getByLabel(/^name/i).fill("whoami");
		await dialog.getByRole("button", { name: /^create$/i }).click();
		await page.waitForURL(/\/services\/application\//, { timeout: 45_000 });
	} else {
		await appLink.click();
		await page.waitForLoadState("networkidle");
	}

	await page.waitForTimeout(1200);
	const body = (await page.textContent("body")) ?? "";
	if (!/traefik\/whoami/i.test(body)) {
		const combo = page.getByRole("combobox").first();
		if (await combo.count()) {
			await combo.click();
			const opt = page.getByRole("option", { name: /docker image/i });
			if (await opt.count()) {
				await opt.click();
				await page.waitForTimeout(400);
				const img = page.locator("#docker-image").first();
				if (await img.count()) {
					await img.fill("traefik/whoami");
					await page
						.getByRole("button", { name: /save source|save/i })
						.first()
						.click();
					await page.waitForTimeout(1500);
				}
			}
		}
	}

	const status = (await page.textContent("body")) ?? "";
	if (!/\brunning\b/i.test(status)) {
		const deploy = page.getByRole("button", { name: /^deploy$/i }).first();
		if (await deploy.count()) {
			await deploy.click();
			console.log("deploying…");
			const start = Date.now();
			while (Date.now() - start < 180_000) {
				await page.waitForTimeout(5000);
				await page.reload({ waitUntil: "networkidle" });
				const t = (await page.textContent("body")) ?? "";
				if (/\brunning\b/i.test(t)) {
					console.log("running");
					break;
				}
				console.log("waiting for running…");
			}
		}
	}

	await shot("04-service", 2000);
	for (const tab of ["Deployments", "Logs", "Monitoring"]) {
		const tabEl = page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") });
		if (await tabEl.count()) {
			await tabEl.first().click();
			await shot(`05-tab-${tab.toLowerCase()}`, tab === "Monitoring" ? 5000 : 2200);
		}
	}

	await page.goto(`${BASE}${projectHref}`, { waitUntil: "networkidle" });
	await shot("03-project", 2200);
	await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
	await shot("02-dashboard", 2200);
	await page.goto(`${BASE}/dashboard/templates`, { waitUntil: "networkidle" });
	await shot("06-templates", 2200);
	await page.goto(`${BASE}/dashboard/docker`, { waitUntil: "networkidle" });
	await shot("07-docker", 2000);
} finally {
	await browser.close();
}

const landingMap = {
	"02-dashboard.png": "02-dashboard.png",
	"03-project.png": "03-project.png",
	"05-tab-deployments.png": "05-tab-deployments.png",
	"05-tab-logs.png": "05-tab-logs.png",
	"05-tab-monitoring.png": "05-tab-monitoring.png",
	"06-templates.png": "06-templates.png",
};
for (const [src, dest] of Object.entries(landingMap)) {
	try {
		copyFileSync(join(OUT, src), join(LANDING, dest));
		console.log("landing", dest);
	} catch (e) {
		console.warn("skip", dest, e.message);
	}
}

const docsMap = {
	"02-dashboard.png": "dashboard.png",
	"03-project.png": "project.png",
	"05-tab-monitoring.png": "monitoring.png",
	"04-service.png": "service.png",
	"06-templates.png": "templates.png",
	"07-docker.png": "docker.png",
};
for (const [src, dest] of Object.entries(docsMap)) {
	try {
		copyFileSync(join(OUT, src), join(DOCS, dest));
		console.log("docs", dest);
	} catch (e) {
		console.warn("skip", dest, e.message);
	}
}
console.log("done");
