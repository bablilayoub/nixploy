/**
 * Seeds demo content (docker-image app + postgres), deploys them, then
 * captures product screenshots for the landing page.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

const BASE = "http://localhost:3000";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
	viewport: { width: 1600, height: 1000 },
	deviceScaleFactor: 2,
});

async function shot(name, settle = 1800) {
	await page.waitForTimeout(settle);
	await page.screenshot({ path: `${OUT}${name}.png` });
	console.log("captured", name);
}

async function login() {
	await page.goto(`${BASE}/login`, { waitUntil: "load" });
	await shot("01-login", 800);
	await page.getByLabel(/email/i).fill(requireEnv("SMOKE_EMAIL"));
	await page.locator('input[type="password"]').first().fill(requireEnv("SMOKE_PASSWORD"));
	await page.getByRole("button", { name: /sign in/i }).click();
	await page.waitForURL(/dashboard/i, { timeout: 30_000 });
	await page.waitForLoadState("networkidle");
}

async function setSourceToDockerImage(image) {
	// Radix Select (role=combobox); the first one on the page is Source Type.
	await page.getByRole("combobox").first().click();
	await page.getByRole("option", { name: "Docker Image" }).click();
	await page.waitForTimeout(600);
	await page.locator("#docker-image").fill(image);
	await page.getByRole("button", { name: /save source/i }).click();
	await page.waitForTimeout(1500);
}

async function waitForRunning(timeoutMs = 180_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const body = await page.textContent("body");
		if (/running/i.test(body ?? "")) return true;
		if (/error|failed/i.test(body ?? "")) {
			// keep waiting briefly — status may flap during rollout
			await page.waitForTimeout(3000);
			const again = await page.textContent("body");
			if (/error|failed/i.test(again ?? "") && !/running/i.test(again ?? "")) return false;
		}
		await page.waitForTimeout(4000);
		await page.reload({ waitUntil: "load" });
	}
	return false;
}

try {
	await login();

	// ---- locate project + app ----
	const projectHref = await page
		.locator('a[href*="/dashboard/projects/"]')
		.first()
		.getAttribute("href");
	await page.goto(`${BASE}${projectHref}`, { waitUntil: "load" });
	await page.waitForTimeout(1500);
	const appHref = await page
		.locator('a[href*="/services/application/"]')
		.first()
		.getAttribute("href");

	await page.goto(`${BASE}${appHref}`, { waitUntil: "load" });
	await page.waitForSelector("text=Source Type", { timeout: 45_000 });
	await page.waitForTimeout(1200);

	// ---- configure docker image source (idempotent enough for re-runs) ----
	const bodyText = await page.textContent("body");
	if (!/traefik\/whoami/.test(bodyText ?? "")) {
		await setSourceToDockerImage("traefik/whoami");
	}
	await shot("04-service-general");

	// ---- deploy ----
	const status = await page.textContent("body");
	if (!/running/i.test(status ?? "")) {
		await page
			.getByRole("button", { name: /^deploy$/i })
			.first()
			.click();
		console.log("deploying…");
		const ok = await waitForRunning();
		console.log("running:", ok);
	}
	await shot("05-service-running");

	// ---- tabs ----
	for (const tab of ["Deployments", "Logs", "Monitoring", "Domains"]) {
		const tabEl = page.getByRole("tab", { name: new RegExp(`^${tab}$`, "i") });
		if (await tabEl.count()) {
			await tabEl.first().click();
			await shot(`06-tab-${tab.toLowerCase()}`, tab === "Monitoring" ? 6000 : 2500);
		}
	}

	// ---- postgres database ----
	await page.goto(`${BASE}${projectHref}`, { waitUntil: "load" });
	await page.waitForTimeout(1000);
	const hasPg = await page.locator('a[href*="/services/postgres/"]').count();
	if (!hasPg) {
		await page
			.getByRole("button", { name: /add service/i })
			.first()
			.click();
		await page.getByRole("menuitem", { name: /^postgresql$/i }).click();
		await page.waitForTimeout(800);
		const dialog = page.locator('[role="dialog"]');
		await dialog.getByLabel(/^name/i).fill("db");
		await dialog.getByRole("button", { name: /^create$/i }).click();
		await page.waitForTimeout(2000);
	}
	const pgHref = await page.locator('a[href*="/services/postgres/"]').first().getAttribute("href");
	await page.goto(`${BASE}${pgHref}`, { waitUntil: "load" });
	await page.waitForTimeout(1200);
	const pgBody = await page.textContent("body");
	if (!/running/i.test(pgBody ?? "")) {
		const deployBtn = page.getByRole("button", { name: /^deploy$/i }).first();
		if (await deployBtn.count()) {
			await deployBtn.click();
			console.log("deploying postgres…");
			console.log("running:", await waitForRunning(240_000));
		}
	}
	await shot("07-postgres");

	// ---- project + dashboard with live services ----
	await page.goto(`${BASE}${projectHref}`, { waitUntil: "load" });
	await shot("03-project", 2500);
	await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
	await shot("02-dashboard", 3000);

	// ---- other pages ----
	await page.goto(`${BASE}/dashboard/templates`, { waitUntil: "load" });
	await shot("08-templates", 2500);
	await page.goto(`${BASE}/dashboard/docker`, { waitUntil: "load" });
	await shot("09-docker", 2000);
} finally {
	await browser.close();
}
console.log("done");
