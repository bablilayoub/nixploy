import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageFrame, ProseLink } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { mcpToolCount } from "@/lib/landing-data";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
	title: "Let an AI agent run your infrastructure",
	description:
		"Nixploy exposes an MCP endpoint so Claude Code, Cursor or Codex can deploy, read logs, diagnose a failure and roll back — through the same routers as the panel, so the organization scope, capability checks and audit trail still apply.",
	alternates: { canonical: `${site.url}/agents` },
};

/**
 * The transcripts below use real tool names from `modules/mcp/tools.ts`. If a
 * tool is renamed or removed the page has to change with it — a demo that
 * shows a call the server cannot answer is worse than no demo.
 */
type Line = { speaker: "you" | "agent"; text: string } | { tool: string; result: string };

const DEPLOY: Line[] = [
	{ speaker: "you", text: "Deploy the api service to staging and put it on a domain." },
	{ tool: "list_projects", result: "acme · staging, production" },
	{ tool: "deploy_and_wait", result: "#d9f3 · build 48s · rollout 11s · 1/1 tasks · done" },
	{ tool: "add_domain", result: "api-staging.acme.dev · certificate issued" },
	{
		speaker: "agent",
		text: "Deployed 4f2a9c1 to staging in 59 s. One replica healthy. https://api-staging.acme.dev is live with a Let's Encrypt certificate.",
	},
];

const DIAGNOSE: Line[] = [
	{ speaker: "you", text: "api-staging is returning 500s. What happened?" },
	{
		tool: "get_service_events",
		result: "restart ×4 · task_failed exit 1 · deploy_finished 6m ago",
	},
	{ tool: "get_service_logs", result: "Error: connect ECONNREFUSED — DATABASE_URL undefined" },
	{ tool: "get_resolved_env", result: "12 variables · DATABASE_URL not set at any level" },
	{
		speaker: "agent",
		text: "The deploy six minutes ago dropped DATABASE_URL — it was set on the old environment, not the project. The container has restarted four times. Want me to set it from the staging database and redeploy?",
	},
	{ speaker: "you", text: "Yes." },
	{ tool: "set_env", result: "DATABASE_URL written (encrypted)" },
	{ tool: "deploy_and_wait", result: "#e104 · done · 1/1 tasks · healthy" },
];

const ROLLBACK: Line[] = [
	{ speaker: "you", text: "The last deploy broke production. Fix it." },
	{
		tool: "explain_last_failure",
		result: "failingStep: converge — new tasks never became healthy",
	},
	{ tool: "list_rollback_points", result: "3 points · newest: 4f2a9c1, 2h ago, green" },
	{ tool: "rollback_deployment", result: "rolled back to 4f2a9c1 · 1/1 tasks · healthy" },
	{
		speaker: "agent",
		text: "Rolled back to 4f2a9c1. The failing deploy never converged — its health check timed out on /ready. Production is serving the previous build again.",
	},
];

/** The config the panel's MCP setup card renders, with a placeholder host and key. */
const MCP_CONFIG = `{
  "mcpServers": {
    "nixploy": {
      "type": "http",
      "url": "https://panel.example.com/api/mcp",
      "headers": { "x-api-key": "nxp_…" }
    }
  }
}`;

/*
 * A session in the frame the home page's agent card uses: three dots and a
 * mono title, then the turns. Speech is body size so it reads as a
 * conversation; the tool calls in between stay mono and indented so they
 * read as the trace it leaves behind.
 */
function Transcript({ title, lines }: { title: string; lines: Line[] }) {
	return (
		<Card className="overflow-hidden p-0">
			<div className="flex h-10 items-center gap-2 border-b bg-accent/40 px-4">
				<span className="flex gap-1.5" aria-hidden>
					<span className="size-2.5 rounded-full bg-muted-foreground/40" />
					<span className="size-2.5 rounded-full bg-muted-foreground/40" />
					<span className="size-2.5 rounded-full bg-muted-foreground/40" />
				</span>
				<span className="flex-1 text-center font-mono text-xs text-muted-foreground">{title}</span>
				<span className="w-[42px]" />
			</div>
			<div className="flex flex-col gap-3 p-5">
				{lines.map((line, index) => {
					if ("tool" in line) {
						return (
							<p
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered transcript
								key={index}
								className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-4 font-mono text-xs"
							>
								<span className="text-foreground">
									<span className="text-muted-foreground">› </span>
									{line.tool}
								</span>
								<span className="text-muted-foreground">{line.result}</span>
							</p>
						);
					}
					return (
						<p
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered transcript
							key={index}
							className={cn(line.speaker === "you" ? "text-foreground" : "text-muted-foreground")}
						>
							<span className="mr-3 font-mono text-xs text-muted-foreground">{line.speaker}</span>
							{line.text}
						</p>
					);
				})}
			</div>
		</Card>
	);
}

/**
 * One session: the ask on the left, the transcript on the right.
 *
 * Not a card around a card — the transcript already has a frame, and wrapping
 * it in a second one made three sessions read as three boxes of boxes. The
 * left column sticks while the transcript scrolls past it, so the question
 * stays next to the answer on a long one.
 */
function Session({
	index,
	heading,
	summary,
	title,
	lines,
}: {
	index: number;
	heading: string;
	summary: string;
	title: string;
	lines: Line[];
}) {
	return (
		<section className="grid gap-6 border-t pt-10 lg:grid-cols-12 lg:gap-12">
			<div className="lg:col-span-4">
				<div className="lg:sticky lg:top-28">
					<p className="font-mono text-xs text-muted-foreground">
						{String(index).padStart(2, "0")}
					</p>
					<h2 className="mt-2 text-2xl font-semibold tracking-tight">{heading}</h2>
					<p className="mt-3 max-w-[32ch] text-muted-foreground">{summary}</p>
				</div>
			</div>
			<div className="min-w-0 lg:col-span-8">
				<Transcript title={title} lines={lines} />
			</div>
		</section>
	);
}

/*
 * A ruled row rather than a card with an icon in a rounded square: four of
 * those in a grid is the shape that makes four different arguments look like
 * one texture (the same reason the home page's free-tier section is a list).
 */
function Reason({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="grid gap-x-8 gap-y-1 border-t py-5 last:border-b sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
			<h3 className="font-medium">{title}</h3>
			<p className="text-sm text-muted-foreground">{children}</p>
		</div>
	);
}

function Code({ children }: { children: ReactNode }) {
	return <code className="rounded bg-accent px-1 py-0.5 font-mono text-xs">{children}</code>;
}

export default function AgentsPage() {
	return (
		<PageFrame
			eyebrow="Agents"
			title="Let an AI agent run your infrastructure"
			description="Nixploy speaks MCP. Point Claude Code, Cursor or Codex at your panel and it can deploy, read the logs, work out why something broke and roll it back — without you opening a terminal."
			actions={
				<>
					<Button asChild size="lg" className="rounded-lg">
						<Link href="/docs/mcp">Set up the MCP server</Link>
					</Button>
					<Button asChild variant="outline" size="lg" className="rounded-lg">
						<Link href="/api">REST API</Link>
					</Button>
				</>
			}
		>
			{/* The four facts that decide whether any of this is a good idea, in the
			    same divided panel the features page opens with. */}
			<ul className="grid grid-cols-2 divide-border overflow-hidden rounded-2xl border bg-card/40 lg:grid-cols-4 lg:divide-x">
				{[
					{ label: "MCP tools", value: `${mcpToolCount} annotated` },
					{ label: "Auth", value: "Scoped API keys" },
					{ label: "Dispatch", value: "The panel's routers" },
					{ label: "Trail", value: "Every mutation audited" },
				].map((item) => (
					<li key={item.label} className="border-b p-5 last:border-b-0 lg:border-b-0">
						<p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
							{item.label}
						</p>
						<p className="mt-2 font-semibold tracking-tight text-balance">{item.value}</p>
					</li>
				))}
			</ul>

			<div className="mt-16 flex flex-col gap-14">
				<Session
					index={1}
					heading="Deploy"
					summary="One prompt. Three tool calls. A URL with a certificate."
					title="mcp · deploy"
					lines={DEPLOY}
				/>
				<Session
					index={2}
					heading="Diagnose"
					summary="The events, the logs and the resolved environment, read before anything is written — and the write waits for a yes."
					title="mcp · diagnose"
					lines={DIAGNOSE}
				/>
				<Session
					index={3}
					heading="Roll back"
					summary="The failure explained in its own step, the pinned images listed, the previous build serving again."
					title="mcp · roll back"
					lines={ROLLBACK}
				/>
			</div>

			<section className="mt-20">
				<h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
					Why this is safe to hand an agent
				</h2>
				<p className="mt-4 max-w-3xl text-muted-foreground">
					The MCP tools are not a second API. Every one of them dispatches through the same tRPC
					routers the panel uses, so the organization scope, the capability checks and the audit
					trail apply identically — an agent holding a read-only API key cannot deploy, and every
					mutation it makes is a row in the audit log with the key that made it.
				</p>
				<div className="mt-8">
					<Reason title="Annotated tools">
						All {mcpToolCount} carry <Code>readOnlyHint</Code>, <Code>destructiveHint</Code> and{" "}
						<Code>idempotentHint</Code>, declared by hand with a test that fails the build on a
						missing entry — so an agent knows what is safe to call while it is still looking around.
					</Reason>
					<Reason title="Scoped keys">
						An API key is read, deploy, write or full, intersected with its owner&apos;s own
						capabilities, bound to one organization, and expiring by default.
					</Reason>
					<Reason title="One call, not a polling loop">
						<Code>deploy_and_wait</Code> blocks for the real outcome;{" "}
						<Code>explain_last_failure</Code> and <Code>get_service_runtime_summary</Code> answer in
						one round trip what would otherwise be five.
					</Reason>
					<Reason title="It reads the docs too">
						<ProseLink href="/llms.txt">/llms.txt</ProseLink>,{" "}
						<ProseLink href="/agents.md">/agents.md</ProseLink> and a <Code>.md</Code> twin of every
						docs page, so an agent can look something up instead of guessing.
					</Reason>
				</div>
			</section>

			<Card className="mt-20 grid gap-10 p-6 sm:p-8 lg:grid-cols-12">
				<div className="lg:col-span-5">
					<h2 className="text-2xl font-semibold tracking-tight">Connect it</h2>
					<p className="mt-4 text-muted-foreground">
						Install Nixploy, mint an API key in Settings → Profile, and copy the config the{" "}
						<span className="text-foreground">MCP setup</span> card renders for your client — it
						already has your instance&apos;s own address filled in.
					</p>
					<p className="mt-6 text-sm text-muted-foreground">
						Full reference in <ProseLink href="/docs/mcp">the MCP guide</ProseLink>; the REST
						surface behind it is at <ProseLink href="/api">the API catalog</ProseLink>.
					</p>
				</div>
				<div className="min-w-0 lg:col-span-7">
					<CodeBlock language="bash" filename="install.sh" code={site.install} />
					<div className="mt-4">
						<CodeBlock language="json" filename="claude_desktop_config.json" code={MCP_CONFIG} />
					</div>
				</div>
			</Card>
		</PageFrame>
	);
}
