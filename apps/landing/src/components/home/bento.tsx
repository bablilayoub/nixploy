"use client";

import {
	Bell,
	Bot,
	Database,
	Globe,
	KeyRound,
	Layers,
	Server,
	ShieldCheck,
	Terminal,
} from "lucide-react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { OrbitingCircles } from "@/components/magicui/orbiting-circles";
import { SpotlightCard } from "@/components/magicui/spotlight-card";
import { Container, SectionHeading } from "@/components/ui";

function CellHeader({
	icon: Icon,
	title,
	body,
}: {
	icon: typeof Database;
	title: string;
	body: string;
}) {
	return (
		<div>
			<div className="mb-4 inline-grid size-10 place-items-center rounded-lg border border-border bg-surface-2 text-accent">
				<Icon className="size-5" strokeWidth={1.6} />
			</div>
			<h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
			<p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
		</div>
	);
}

/* ───────────── mini visualisations ───────────── */

function BackupsViz() {
	const rows = [
		["postgres-17", "02:00 daily", "s3://backups/prod", "ok"],
		["mongo-7", "*/6 hours", "s3://backups/prod", "ok"],
		["volume · uploads", "sun 03:00", "r2://archive", "ok"],
		["nixploy (self)", "01:30 daily", "s3://backups/panel", "ok"],
	];
	return (
		<div className="mt-5 overflow-hidden rounded-lg border border-border bg-[#0c0e12] font-mono text-[11px]">
			{rows.map(([name, cron, dest]) => (
				<div
					key={name}
					className="flex items-center gap-3 border-b border-border/70 px-3 py-2 last:border-0"
				>
					<span className="size-1.5 rounded-full bg-success" />
					<span className="text-foreground">{name}</span>
					<span className="text-muted-2">{cron}</span>
					<span className="ml-auto truncate text-muted-2">{dest}</span>
				</div>
			))}
		</div>
	);
}

function DomainsViz() {
	return (
		<div className="mt-5 space-y-2 font-mono text-[11px]">
			{[
				["app.example.com", "Let's Encrypt", true],
				["api.example.com/v1", "Let's Encrypt", true],
				["staging-8e1f.traefik.me", "self-signed", false],
			].map(([host, cert, lock]) => (
				<div
					key={String(host)}
					className="flex items-center justify-between rounded-md border border-border bg-[#0c0e12] px-3 py-2"
				>
					<span className="text-foreground">{host}</span>
					<span className={lock ? "text-success" : "text-muted-2"}>{cert}</span>
				</div>
			))}
		</div>
	);
}

function MetricsViz() {
	const points = [22, 28, 26, 40, 38, 52, 47, 61, 58, 66, 63, 72, 70, 64, 68, 75, 71, 78];
	const w = 260;
	const h = 72;
	const max = 100;
	const path = points
		.map((p, i) => `${(i / (points.length - 1)) * w},${h - (p / max) * h}`)
		.join(" L ");
	return (
		<div className="mt-5 rounded-lg border border-border bg-[#0c0e12] p-3">
			<div className="flex items-center justify-between font-mono text-[11px] text-muted-2">
				<span>cpu · api-42 · 1h</span>
				<span className="text-accent">78%</span>
			</div>
			<svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-20 w-full" aria-hidden>
				<defs>
					<linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
						<stop offset="0" stopColor="#f2b53d" stopOpacity="0.35" />
						<stop offset="1" stopColor="#f2b53d" stopOpacity="0" />
					</linearGradient>
				</defs>
				<path d={`M 0,${h} L ${path} L ${w},${h} Z`} fill="url(#spark)" />
				<path d={`M ${path}`} fill="none" stroke="#f2b53d" strokeWidth="1.5" />
				<line
					x1="0"
					x2={w}
					y1={h - 0.8 * h}
					y2={h - 0.8 * h}
					stroke="#ff6b6b"
					strokeDasharray="3 3"
					strokeOpacity="0.6"
				/>
			</svg>
		</div>
	);
}

function TeamViz() {
	const caps = [
		["service.deploy", true],
		["secrets.read", false],
		["domains.manage", true],
		["members.manage", false],
	] as const;
	return (
		<div className="mt-5 grid grid-cols-2 gap-2 font-mono text-[11px]">
			{caps.map(([cap, on]) => (
				<div
					key={cap}
					className="flex items-center justify-between rounded-md border border-border bg-[#0c0e12] px-2.5 py-2"
				>
					<span className="text-muted">{cap}</span>
					<span
						className={
							on
								? "h-3.5 w-6 rounded-full bg-accent/80 ring-1 ring-accent"
								: "h-3.5 w-6 rounded-full bg-surface-3 ring-1 ring-border"
						}
					/>
				</div>
			))}
		</div>
	);
}

function ServersViz() {
	return (
		<div className="relative mt-3 flex h-44 items-center justify-center overflow-hidden">
			<div className="absolute grid size-12 place-items-center rounded-xl border border-accent/50 bg-accent-soft text-accent">
				<Server className="size-5" />
			</div>
			<OrbitingCircles radius={64} duration={22} iconSize={28}>
				<span className="grid size-7 place-items-center rounded-md border border-border bg-surface-2 text-[10px] text-muted">
					w1
				</span>
				<span className="grid size-7 place-items-center rounded-md border border-border bg-surface-2 text-[10px] text-muted">
					w2
				</span>
				<span className="grid size-7 place-items-center rounded-md border border-border bg-surface-2 text-[10px] text-muted">
					m2
				</span>
			</OrbitingCircles>
			<span className="animate-pulse-ring absolute size-12 rounded-xl border border-accent/40" />
		</div>
	);
}

function ChannelsViz() {
	const channels = [
		"Slack",
		"Discord",
		"Telegram",
		"Email",
		"Gotify",
		"ntfy",
		"Pushover",
		"Mattermost",
		"Lark",
		"Teams",
		"Webhook",
	];
	return (
		<div className="mt-5 flex flex-wrap gap-1.5">
			{channels.map((c) => (
				<span
					key={c}
					className="rounded-md border border-border bg-[#0c0e12] px-2 py-1 font-mono text-[11px] text-muted"
				>
					{c}
				</span>
			))}
		</div>
	);
}

function ApiViz() {
	return (
		<div className="code mt-5 rounded-lg border border-border bg-[#0c0e12] p-3 text-[11px]">
			<p>
				<span className="c-dim">GET </span>
				<span className="c-key">/api/project.all</span>
			</p>
			<p>
				<span className="c-dim">POST </span>
				<span className="c-key">/api/application.deploy</span>
			</p>
			<p>
				<span className="c-dim">POST </span>
				<span className="c-key">/api/mcp</span>
				<span className="c-dim"> · tools/call deploy_service</span>
			</p>
			<p className="mt-1 c-dim">$ nixploy app logs 69dd… -f</p>
		</div>
	);
}

export function Bento() {
	return (
		<section id="features" className="py-20 sm:py-28">
			<Container>
				<BlurFade inView>
					<SectionHeading
						eyebrow="Everything a PaaS does"
						title="On hardware you already pay for."
						lede="Not a thin wrapper around docker run. The whole loop — build, expose, back up, observe, alert, recover, automate — with the sharp edges filed off."
					/>
				</BlurFade>

				<div className="mt-12 grid gap-4 md:grid-cols-6">
					<BlurFade inView className="md:col-span-3">
						<SpotlightCard className="h-full p-6">
							<CellHeader
								icon={Database}
								title="Databases with real backups"
								body="Postgres, MySQL, MariaDB, MongoDB, Redis. Scheduled dumps and volume snapshots to any S3-compatible bucket, restore from the panel — and Nixploy backs itself up too."
							/>
							<BackupsViz />
						</SpotlightCard>
					</BlurFade>
					<BlurFade inView delay={0.05} className="md:col-span-3">
						<SpotlightCard className="h-full p-6">
							<CellHeader
								icon={Globe}
								title="Domains and TLS that just work"
								body="Attach a hostname, Traefik issues the Let's Encrypt certificate and hot-reloads the route. Redirects, basic-auth and custom certs live in the same tab."
							/>
							<DomainsViz />
						</SpotlightCard>
					</BlurFade>

					<BlurFade inView delay={0.1} className="md:col-span-2">
						<SpotlightCard className="h-full p-6">
							<CellHeader
								icon={Layers}
								title="Metrics that match reality"
								body="Container-level CPU, memory, network and disk, 48 h of history, alerts to your channels."
							/>
							<MetricsViz />
						</SpotlightCard>
					</BlurFade>
					<BlurFade inView delay={0.15} className="md:col-span-2">
						<SpotlightCard className="h-full p-6">
							<CellHeader
								icon={ShieldCheck}
								title="Teams without a shared password"
								body="Roles plus per-member capability overlays, org-wide 2FA enforcement, and an audit log of every destructive action."
							/>
							<TeamViz />
						</SpotlightCard>
					</BlurFade>
					<BlurFade inView delay={0.2} className="md:col-span-2">
						<SpotlightCard className="h-full p-6">
							<CellHeader
								icon={Server}
								title="One Swarm, many servers"
								body="Add hosts over SSH; they join the same Swarm. Placement constraints decide where things run."
							/>
							<ServersViz />
						</SpotlightCard>
					</BlurFade>

					<BlurFade inView delay={0.25} className="md:col-span-2">
						<SpotlightCard className="h-full p-6">
							<CellHeader
								icon={Terminal}
								title="Same API for humans, CI and agents"
								body="Every panel action is a REST endpoint with OpenAPI docs, a CLI command, and an MCP tool."
							/>
							<ApiViz />
						</SpotlightCard>
					</BlurFade>
					<BlurFade inView delay={0.3} className="md:col-span-2">
						<SpotlightCard className="h-full p-6">
							<CellHeader
								icon={Bell}
								title="Eleven notification channels"
								body="Deploys, build failures, backups, threshold alerts, uptime flips — routed wherever your team already looks."
							/>
							<ChannelsViz />
						</SpotlightCard>
					</BlurFade>
					<BlurFade inView delay={0.35} className="md:col-span-2">
						<SpotlightCard className="h-full p-6">
							<CellHeader
								icon={Bot}
								title="Deploy Copilot, bring your own key"
								body="Explain a failed build, apply the suggested env fix and redeploy, or draft a compose file from a sentence. Confirm-gated, never auto-deploys."
							/>
							<div className="mt-5 rounded-lg border border-border bg-[#0c0e12] p-3 text-[12px] leading-relaxed text-muted">
								<span className="text-accent">copilot ›</span> Build failed because{" "}
								<span className="text-foreground">DATABASE_URL</span> is unset at build time. Apply{" "}
								<span className="text-foreground">NIXPACKS_NO_CACHE=1</span> and move the variable
								to runtime?{" "}
								<span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">
									Apply & redeploy
								</span>
							</div>
						</SpotlightCard>
					</BlurFade>
				</div>

				<div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
					<span className="inline-flex items-center gap-2">
						<KeyRound className="size-4 text-accent" /> Secrets encrypted at rest
					</span>
					<span className="inline-flex items-center gap-2">
						<Layers className="size-4 text-accent" /> Compose &amp; Swarm stacks first-class
					</span>
					<span className="inline-flex items-center gap-2">
						<Terminal className="size-4 text-accent" /> Web terminal into any container
					</span>
				</div>
			</Container>
		</section>
	);
}
