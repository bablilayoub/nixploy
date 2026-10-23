import { loadPublicStatus, type PublicStatus } from "@nixploy/server/modules/observability/index";
import { clientIpFromRequest, takeIpRateLimitToken } from "@nixploy/server/utils/rate-limit";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

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
		status === "up" ? "bg-emerald-500" : status === "down" ? "bg-red-500" : "bg-muted-foreground";
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
		<main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-12">
			<header className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">{status.title}</h1>
				<p className="text-sm text-muted-foreground">
					{status.probes.length === 0
						? "No services are published on this status page."
						: anyDown
							? "Some services are down."
							: allUp
								? "All services are operational."
								: "Service state is being determined."}
				</p>
			</header>

			<section className="flex flex-col gap-px overflow-hidden rounded-lg border bg-border">
				{status.probes.map((probe) => (
					<div
						key={probe.name}
						className="flex flex-wrap items-center justify-between gap-3 bg-background px-4 py-3"
					>
						<div className="flex min-w-0 items-center gap-2.5">
							<StateDot status={probe.status} />
							<span className="truncate text-sm font-medium">{probe.name}</span>
						</div>
						<div className="flex items-center gap-4 text-sm text-muted-foreground">
							<span className="tabular-nums">
								{probe.uptimePercent.toFixed(2)}% · {status.uptimeDays}d
							</span>
							<span>{STATE_LABEL[probe.status] ?? probe.status}</span>
						</div>
					</div>
				))}
				{status.probes.length === 0 ? (
					<p className="bg-background px-4 py-8 text-center text-sm text-muted-foreground">
						Nothing published yet.
					</p>
				) : null}
			</section>

			{status.incidents.length > 0 ? (
				<section className="flex flex-col gap-3">
					<h2 className="text-sm font-semibold">Recent incidents</h2>
					<ul className="flex flex-col gap-2">
						{status.incidents.map((incident) => (
							<li
								key={`${incident.title}-${incident.createdAt.toISOString()}`}
								className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
							>
								<span className="truncate">{incident.title}</span>
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
