import type { Metadata } from "next";

import { InstallCommand } from "@/components/install-command";
import { PageShell, ProseLink } from "@/components/page-shell";
import { site } from "@/lib/site";

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

function Transcript({ title, lines }: { title: string; lines: Line[] }) {
	return (
		<div className="overflow-hidden rounded-xl border border-border bg-surface/40">
			<div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted">
				{title}
			</div>
			<div className="space-y-2.5 p-4">
				{lines.map((line, index) => {
					if ("tool" in line) {
						return (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered transcript
								key={index}
								className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-4 font-mono text-xs"
							>
								<span className="text-muted">→</span>
								<span className="text-foreground">{line.tool}</span>
								<span className="text-muted">{line.result}</span>
							</div>
						);
					}
					return (
						<p
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered transcript
							key={index}
							className="text-sm leading-relaxed"
						>
							<span
								className={
									line.speaker === "you"
										? "mr-2 text-xs uppercase tracking-wide text-muted"
										: "mr-2 text-xs uppercase tracking-wide text-muted"
								}
							>
								{line.speaker === "you" ? "You" : "Agent"}
							</span>
							<span className={line.speaker === "you" ? "text-foreground" : "text-muted"}>
								{line.text}
							</span>
						</p>
					);
				})}
			</div>
		</div>
	);
}

export default function AgentsPage() {
	return (
		<PageShell
			wide
			eyebrow="Agents"
			title="Let an AI agent run your infrastructure"
			description="Nixploy speaks MCP. Point Claude Code, Cursor or Codex at your panel and it can deploy, read the logs, work out why something broke and roll it back — without you opening a terminal."
		>
			<div className="space-y-6">
				<Transcript title="Deploy" lines={DEPLOY} />
				<Transcript title="Diagnose" lines={DIAGNOSE} />
				<Transcript title="Roll back" lines={ROLLBACK} />
			</div>

			<section className="mt-14">
				<h2 className="font-display text-xl font-semibold tracking-tight">
					Why this is safe to hand an agent
				</h2>
				<p className="mt-3 text-sm leading-relaxed text-muted">
					The MCP tools are not a second API. Every one of them dispatches through the same tRPC
					routers the panel uses, so the organization scope, the capability checks and the audit
					trail apply identically — an agent holding a read-only API key cannot deploy, and every
					mutation it makes is a row in the audit log with the key that made it.
				</p>
				<ul className="mt-5 space-y-2.5 text-sm leading-relaxed text-muted">
					<li>
						· <span className="text-foreground">Annotated tools.</span> All 35 carry
						<span className="font-mono text-xs"> readOnlyHint</span>,
						<span className="font-mono text-xs"> destructiveHint</span> and
						<span className="font-mono text-xs"> idempotentHint</span>, declared by hand with a test
						that fails the build on a missing entry — so an agent knows what is safe to call while
						it is still looking around.
					</li>
					<li>
						· <span className="text-foreground">Scoped keys.</span> An API key is read, deploy,
						write or full, intersected with its owner&apos;s own capabilities, bound to one
						organization, and expiring by default.
					</li>
					<li>
						· <span className="text-foreground">One call, not a polling loop.</span>{" "}
						<span className="font-mono text-xs">deploy_and_wait</span> blocks for the real outcome;
						<span className="font-mono text-xs"> explain_last_failure</span> and
						<span className="font-mono text-xs"> get_service_runtime_summary</span> answer in one
						round trip what would otherwise be five.
					</li>
					<li>
						· <span className="text-foreground">It reads the docs too.</span>{" "}
						<ProseLink href="/llms.txt">/llms.txt</ProseLink>,{" "}
						<ProseLink href="/agents.md">/agents.md</ProseLink> and a{" "}
						<span className="font-mono text-xs">.md</span> twin of every docs page, so an agent can
						look something up instead of guessing.
					</li>
				</ul>
			</section>

			<section className="mt-14">
				<h2 className="font-display text-xl font-semibold tracking-tight">Connect it</h2>
				<p className="mt-3 text-sm text-muted">
					Install Nixploy, mint an API key in Settings → Profile, and copy the config the{" "}
					<span className="text-foreground">MCP setup</span> card renders for your client — it
					already has your instance&apos;s own address filled in.
				</p>
				<div className="mt-4">
					<InstallCommand />
				</div>
				<pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface/40 p-4 font-mono text-xs leading-relaxed text-muted">
					{`{
  "mcpServers": {
    "nixploy": {
      "type": "http",
      "url": "https://panel.example.com/api/mcp",
      "headers": { "x-api-key": "nxp_…" }
    }
  }
}`}
				</pre>
				<p className="mt-4 text-sm text-muted">
					Full reference in <ProseLink href="/docs/mcp">the MCP guide</ProseLink>; the REST surface
					behind it is at <ProseLink href="/api">the API catalog</ProseLink>.
				</p>
			</section>
		</PageShell>
	);
}
