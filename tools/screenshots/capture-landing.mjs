/**
 * Captures the product screenshots the landing site uses, from a running
 * panel. Read-only: it never creates, deploys or deletes anything — point it
 * at an instance that already has workload on it.
 *
 *   SMOKE_EMAIL=you@example.com SMOKE_PASSWORD=… \
 *     [PANEL=http://localhost:3100] node capture-landing.mjs
 *
 * Output lands in out/landing/. Review it before copying over
 * apps/landing/public/screenshots — a blank or half-loaded capture is worse
 * than the stale one it would replace, so every shot is asserted first.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.PANEL ?? "http://localhost:3100";
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
if (!EMAIL || !PASSWORD) {
	console.error("SMOKE_EMAIL and SMOKE_PASSWORD are required");
	process.exit(1);
}

const OUT = new URL("./out/landing/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1600, height: 1000 },
	deviceScaleFactor: 2,
	colorScheme: "dark",
});
// providers.tsx is next-themes with defaultTheme="light" and no custom
// storageKey, so the theme is decided by localStorage, not by colorScheme.
await context.addInitScript(() => {
	try {
		localStorage.setItem("theme", "dark");
	} catch {
		/* private mode */
	}
});
const page = await context.newPage();

const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

/** A capture only counts if the page rendered the thing it is meant to show. */
/**
 * Clip to where the content actually ends. A panel page rarely fills 1000px,
 * and shipping the empty half makes the screenshot look like a bug.
 */
async function contentClip() {
	const bottom = await page.evaluate(() => {
		const main = document.querySelector("main") ?? document.body;
		let lowest = 0;
		for (const node of main.querySelectorAll("*")) {
			const rect = node.getBoundingClientRect();
			if (rect.width > 40 && rect.height > 8 && rect.bottom > lowest) lowest = rect.bottom;
		}
		return Math.ceil(lowest);
	});
	const height = Math.min(1000, Math.max(420, bottom + 24));
	return { x: 0, y: 0, width: 1600, height };
}

async function shot(name, { expect, settle = 2500, hideCardsTitled = [] }) {
	await page.waitForTimeout(settle);
	/*
	 * Onboarding chrome is real UI but it is not the product. Hiding it for the
	 * shot changes nothing in the panel — unlike clicking its dismiss button,
	 * which would write to the operator's state. Matched by visible title, then
	 * walked up to the enclosing card, so it survives class-name churn.
	 */
	if (hideCardsTitled.length > 0) {
		await page.evaluate((titles) => {
			for (const title of titles) {
				const heading = [...document.querySelectorAll("h1,h2,h3,h4,div,span")].find(
					(node) => node.textContent?.trim() === title,
				);
				const card = heading?.closest('[class*="rounded"]');
				if (card instanceof HTMLElement) card.style.display = "none";
			}
		}, hideCardsTitled);
		await page.waitForTimeout(300);
	}
	// Sonner toasts ("Signed in") auto-dismiss; do not photograph one.
	await page
		.locator("[data-sonner-toast]")
		.first()
		.waitFor({ state: "detached", timeout: 8000 })
		.catch(() => {});
	await page.waitForTimeout(400);
	const body = (await page.textContent("body")) ?? "";
	const missing = expect.filter((needle) => !new RegExp(needle, "i").test(body));
	if (missing.length > 0) {
		console.error(`SKIPPED ${name} — page did not show: ${missing.join(", ")}`);
		return false;
	}
	const clip = await contentClip();
	await page.screenshot({ path: `${OUT}${name}.png`, clip });
	console.log(`captured ${name} (${clip.height}px)`);
	return true;
}

async function go(path) {
	await page.goto(`${BASE}${path}`, { waitUntil: "load" });
	await page.waitForLoadState("networkidle").catch(() => {});
}

try {
	await go("/login");
	await page.getByLabel(/email/i).fill(EMAIL);
	await page.locator('input[type="password"]').first().fill(PASSWORD);
	// Exact: the passkey button also matches /sign in/i and trips strict mode.
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	try {
		await page.waitForURL(/dashboard/i, { timeout: 30_000 });
	} catch {
		// A stack trace here reads as a broken script; it is almost always a
		// wrong password, an unverified email or a 2FA prompt.
		const shown = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 300);
		console.error(`login did not reach /dashboard. The page says: ${shown}`);
		process.exitCode = 1;
		throw new Error("login failed");
	}
	await page.waitForLoadState("networkidle").catch(() => {});

	const results = {};

	results["02-dashboard"] = await shot("02-dashboard", {
		expect: ["projects"],
		settle: 3500,
		// The "Finish setting up" checklist (getting-started-card.tsx).
		hideCardsTitled: ["Finish setting up"],
	});

	await go("/dashboard/templates");
	results["07-templates"] = await shot("07-templates", { expect: ["templates", "deploy"] });

	await go("/dashboard/docker");
	results["07-docker"] = await shot("07-docker", { expect: ["containers"], settle: 3000 });

	/*
	 * Discovery, not guesswork. Two things the first version got wrong:
	 * there is no /dashboard/projects index route (only /dashboard/projects/
	 * [projectId]), so project links are found on /dashboard itself; and it
	 * looked for them while sitting on whatever page the previous shot left
	 * behind.
	 *
	 * Both picks optimise the shot: the project with the most services, and
	 * within it a running service, so Runtime has real series instead of an
	 * empty state.
	 */
	async function pickProject() {
		await go("/dashboard");
		const hrefs = await page.locator('a[href*="/dashboard/projects/"]').evaluateAll((nodes) => [
			...new Set(nodes.map((node) => node.getAttribute("href")).filter(Boolean)),
		]);
		if (hrefs.length === 0) return null;

		let best = null;
		for (const href of hrefs) {
			await go(href);
			const services = await page.locator('a[href*="/services/"]').count();
			if (!best || services > best.services) best = { href, services };
		}
		console.log(`project: ${best.href} (${best.services} services)`);
		return best.href;
	}

	async function pickService(projectPath) {
		await go(projectPath);
		// Prefer a row that reports Running; fall back to any service.
		const running = page
			.locator("tr", { hasText: /running/i })
			.locator('a[href*="/services/"]')
			.first();
		const href = (await running.count())
			? await running.getAttribute("href")
			: await page.locator('a[href*="/services/"]').first().getAttribute("href").catch(() => null);
		if (href) console.log(`service: ${href}`);
		return href;
	}

	const projectPath = await pickProject();
	if (projectPath) {
		await go(projectPath);
		results["03-project"] = await shot("03-project", { expect: ["service"], settle: 3000 });

		const servicePath = await pickService(projectPath);
		if (servicePath) {
			// Still on the project page after pickService — resolve the metrics
			// subject now, because its link does not exist anywhere else.
			const databasePath = await page
				.locator(
					'a[href*="/services/postgres/"], a[href*="/services/mysql/"], a[href*="/services/mongo/"], a[href*="/services/redis/"]',
				)
				.first()
				.getAttribute("href", { timeout: 5000 })
				.catch(() => null);

			await go(`${servicePath}?tab=deploy`);
			results["05-deployments"] = await shot("05-deployments", {
				expect: ["deployment"],
				settle: 3000,
			});
			/*
			 * Monitoring gets its own subject. An application like traefik/whoami
			 * answers in microseconds, so no amount of traffic moves its CPU off
			 * zero and every chart is a flat line. A database idles with real
			 * memory and a real process count, which is what the shot needs to
			 * show. Falls back to the same service as the deployments shot.
			 */
			const metricsPath = databasePath ?? servicePath;
			console.log(`metrics subject: ${metricsPath}`);
			await go(`${metricsPath}?tab=monitoring`);
			// Metrics stream in, so this one needs longer than the rest.
			results["06-monitoring"] = await shot("06-monitoring", {
				expect: ["cpu|memory"],
				settle: 9000,
			});
		} else {
			console.error("no service on the project — skipped 05-deployments and 06-monitoring");
		}
	} else {
		console.error("no project links on /dashboard — skipped 03, 05 and 06");
	}

	console.log("\n--- summary ---");
	for (const [name, ok] of Object.entries(results)) console.log(`${ok ? "ok  " : "MISS"} ${name}`);
	if (problems.length > 0) console.log("page errors:", problems);
	console.log(`\noutput: ${OUT}`);
} finally {
	await context.close();
	await browser.close();
}
