import { loadPublicStatus, type PublicStatus } from "@nixploy/server/modules/observability/index";
import { clientIpFromRequest, takeIpRateLimitToken } from "@nixploy/server/utils/rate-limit";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ModeToggle } from "@/components/mode-toggle";
import { PublicStatusRefresh } from "@/components/monitoring/public-status-refresh";
import { Logo } from "@/components/shell/logo";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Public status page — the only unauthenticated view of organization data in
 * the panel. It is addressed by an unguessable token minted by
 * `observability.enableStatusPage`, and `loadPublicStatus` is the single
 * function that turns such a token into data (probe host, current state,
 * 90-day uptime, incident titles — nothing else).
 *
 * "Static-ish": the page is dynamic (it needs the client IP for the rate
 * limit), but a 30 s in-process memo means a hammered URL costs one pair of
 * queries per token per window. Unknown tokens are the case the per-IP limit
 * exists for — each one would otherwise be a cache miss by construction.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
/** Bound the memo so token enumeration cannot grow it without limit. */
const CACHE_MAX_ENTRIES = 200;

type CacheEntry = { at: number; value: PublicStatus | null };
const cache = new Map<string, CacheEntry>();

async function cachedStatus(token: string): Promise<PublicStatus | null> {
	const hit = cache.get(token);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
	const value = await loadPublicStatus(token);
	if (cache.size >= CACHE_MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest) cache.delete(oldest);
	}
	cache.set(token, { at: Date.now(), value });
	return value;
}

/** Per-IP flood guard; widened automatically when no trusted proxy reveals the IP. */
async function assertWithinRateLimit(): Promise<void> {
	const requestHeaders = await headers();
	const ip = clientIpFromRequest(new Request("http://status.local", { headers: requestHeaders }));
	if (!takeIpRateLimitToken("status-page", ip, { windowMs: 60_000, max: 60 })) {
		// A 404 here would be a lie; the page has no error boundary of its own,
		// so throwing surfaces the app's error page with a 500.
		throw new Error("Too many requests");
	}
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ token: string }>;
}): Promise<Metadata> {
	const { token } = await params;
	const status = await cachedStatus(token).catch(() => null);
	return {
		title: status?.title ?? "Status",
		// A status page indexed by search engines defeats the point of the token.
		robots: { index: false, follow: false },
	};
}

const STATE_LABEL: Record<string, string> = {
	up: "Operational",
	down: "Down",
	unknown: "Unknown",
};

function StateDot({ status }: { status: "up" | "down" | "unknown" }) {
	const color =
		status === "up" ? "bg-success" : status === "down" ? "bg-destructive" : "bg-muted-foreground";
	return <span className={`size-2.5 shrink-0 rounded-full ${color}`} aria-hidden />;
}

export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
	await assertWithinRateLimit();
	const { token } = await params;
	const status = await cachedStatus(token);
	if (!status) notFound();

	const allUp = status.probes.length > 0 && status.probes.every((probe) => probe.status === "up");
	const anyDown = status.probes.some((probe) => probe.status === "down");

	return (
		<main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8 sm:py-12">
			<div className="mb-4 flex items-center justify-between gap-4">
				<Logo />
				<ModeToggle />
			</div>
			<Card>
				<header className="flex flex-col gap-4 p-6 sm:p-8">
					<p className="text-xs text-muted-foreground normal-case">Service status</p>
					<h1 className="text-3xl leading-tight font-semibold tracking-[-0.04em]">
						{status.title}
					</h1>
					<p className="text-sm text-muted-foreground">
						{status.probes.length === 0
							? "No services are published on this status page."
							: anyDown
								? "Some services are down."
								: allUp
									? "All services are operational."
									: "Service state is being determined."}
					</p>
					<PublicStatusRefresh generatedAt={status.generatedAt.toISOString()} />
				</header>
			</Card>

			<Card role="region" aria-label="Published service availability" className="min-w-0">
				<CardContent className="flex flex-col divide-y overflow-hidden">
					{status.probes.map((probe) => (
						<div
							key={probe.name}
							className="flex flex-wrap items-center justify-between gap-3 bg-card px-5 py-5"
						>
							<div className="flex min-w-0 items-center gap-2.5">
								<StateDot status={probe.status} />
								<span className="break-words text-sm font-medium">{probe.name}</span>
							</div>
							<div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
								<span className="tabular-nums">
									{probe.uptimePercent.toFixed(2)}% uptime over {status.uptimeDays} days
								</span>
								<span>{STATE_LABEL[probe.status] ?? probe.status}</span>
							</div>
						</div>
					))}
					{status.probes.length === 0 ? (
						<p className="bg-card px-4 py-8 text-center text-sm text-muted-foreground">
							Nothing published yet.
						</p>
					) : null}
				</CardContent>
			</Card>

			{status.incidents.length > 0 ? (
				<section className="flex flex-col gap-3">
					<h2 className="text-sm font-semibold">Recent incidents</h2>
					<ul className="flex flex-col gap-2">
						{status.incidents.map((incident) => (
							<li
								key={`${incident.title}-${incident.createdAt.toISOString()}`}
								className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-4 text-sm"
							>
								<span className="break-words">{incident.title}</span>
								<span className="text-xs text-muted-foreground">
									{incident.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
									{incident.resolvedAt ? " · resolved" : ""}
								</span>
							</li>
						))}
					</ul>
				</section>
			) : null}

			<footer className="text-xs text-muted-foreground">
				Updated {status.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC · powered by
				Nixploy
			</footer>
		</main>
	);
}
