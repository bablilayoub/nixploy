import { BookOpen, KeyRound, ShieldCheck, Zap } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { InstallCommand } from "@/components/install-command";
import { PageShell, ProseLink } from "@/components/page-shell";
import { Card, CodeBlock, Panel, Pill, SectionTitle, TerminalFrame, Tile } from "@/components/ui";
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
		<TerminalFrame title={title} tag="session" bodyClassName="p-5 leading-normal">
			<div className="flex flex-col gap-3">
				{lines.map((line, index) => {
					if ("tool" in line) {
						return (
							<p
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered transcript
								key={index}
								className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-4 font-mono text-micro"
							>
								<span className="text-foreground">
									<span className="text-muted-2">› </span>
									{line.tool}
								</span>
								<span className="text-muted">{line.result}</span>
							</p>
						);
					}
					return (
						<p
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered transcript
							key={index}
							className={cn("text-body", line.speaker === "you" ? "text-foreground" : "text-muted")}
						>
							<span className="mr-3 font-mono text-micro text-muted-2">{line.speaker}</span>
							{line.text}
						</p>
					);
				})}
			</div>
		</TerminalFrame>
	);
}

/** Text beside the transcript: the reference's text-beside-card block, one per session. */
function Session({
	heading,
	summary,
	title,
	lines,
}: {
	heading: string;
	summary: string;
	title: string;
	lines: Line[];
}) {
	return (
		<Card className="grid gap-8 p-8 sm:p-10 lg:grid-cols-12 lg:gap-12">
			<div className="lg:col-span-4">
				<h2 className="text-title text-foreground">{heading}</h2>
				<p className="mt-4 max-w-[30ch] text-body text-muted">{summary}</p>
			</div>
			<div className="min-w-0 lg:col-span-8">
				<Transcript title={title} lines={lines} />
			</div>
		</Card>
	);
}

function Reason({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<Panel>
			<Tile size={40}>{icon}</Tile>
			<h3 className="mt-5 text-body font-medium text-foreground">{title}</h3>
			<p className="mt-2 text-small text-muted">{children}</p>
		</Panel>
	);
}

function Code({ children }: { children: ReactNode }) {
	return <code className="font-mono text-micro text-foreground">{children}</code>;
}

export default function AgentsPage() {
	return (
		<PageShell
			eyebrow="Agents"
			title="Let an AI agent run your infrastructure"
			description="Nixploy speaks MCP. Point Claude Code, Cursor or Codex at your panel and it can deploy, read the logs, work out why something broke and roll it back — without you opening a terminal."
			actions={
				<>
					<Pill href="/docs/mcp" arrow>
						Set up the MCP server
					</Pill>
					<Pill href="/api" variant="ghost">
						REST API
					</Pill>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<Session
					heading="Deploy"
					summary="One prompt. Three tool calls. A URL with a certificate."
					title="mcp · deploy"
					lines={DEPLOY}
				/>
				<Session
					heading="Diagnose"
					summary="The events, the logs and the resolved environment, read before anything is written — and the write waits for a yes."
					title="mcp · diagnose"
					lines={DIAGNOSE}
				/>
				<Session
					heading="Roll back"
					summary="The failure explained in its own step, the pinned images listed, the previous build serving again."
					title="mcp · roll back"
					lines={ROLLBACK}
				/>
			</div>

			<section className="mt-32">
				<SectionTitle title="Why this is safe to hand an agent">
					The MCP tools are not a second API. Every one of them dispatches through the same tRPC
					routers the panel uses, so the organization scope, the capability checks and the audit
					trail apply identically — an agent holding a read-only API key cannot deploy, and every
					mutation it makes is a row in the audit log with the key that made it.
				</SectionTitle>
				<div className="mt-12 grid gap-4 md:grid-cols-2">
					<Reason icon={<ShieldCheck className="size-5" aria-hidden />} title="Annotated tools">
						All {mcpToolCount} carry <Code>readOnlyHint</Code>, <Code>destructiveHint</Code> and{" "}
						<Code>idempotentHint</Code>, declared by hand with a test that fails the build on a
						missing entry — so an agent knows what is safe to call while it is still looking around.
					</Reason>
					<Reason icon={<KeyRound className="size-5" aria-hidden />} title="Scoped keys">
						An API key is read, deploy, write or full, intersected with its owner&apos;s own
						capabilities, bound to one organization, and expiring by default.
					</Reason>
					<Reason
						icon={<Zap className="size-5" aria-hidden />}
						title="One call, not a polling loop"
					>
						<Code>deploy_and_wait</Code> blocks for the real outcome;{" "}
						<Code>explain_last_failure</Code> and <Code>get_service_runtime_summary</Code> answer in
						one round trip what would otherwise be five.
					</Reason>
					<Reason icon={<BookOpen className="size-5" aria-hidden />} title="It reads the docs too">
						<ProseLink href="/llms.txt">/llms.txt</ProseLink>,{" "}
						<ProseLink href="/agents.md">/agents.md</ProseLink> and a <Code>.md</Code> twin of every
						docs page, so an agent can look something up instead of guessing.
					</Reason>
				</div>
			</section>

			<Card className="mt-32 grid gap-10 p-8 sm:p-10 lg:grid-cols-12">
				<div className="lg:col-span-5">
					<h2 className="text-title text-foreground">Connect it</h2>
					<p className="mt-4 text-body text-muted">
						Install Nixploy, mint an API key in Settings → Profile, and copy the config the{" "}
						<span className="text-foreground">MCP setup</span> card renders for your client — it
						already has your instance&apos;s own address filled in.
					</p>
					<p className="mt-6 text-small text-muted">
						Full reference in <ProseLink href="/docs/mcp">the MCP guide</ProseLink>; the REST
						surface behind it is at <ProseLink href="/api">the API catalog</ProseLink>.
					</p>
				</div>
				<div className="lg:col-span-7">
					<InstallCommand />
					<CodeBlock className="mt-4" title="claude_desktop_config.json" code={MCP_CONFIG} />
				</div>
			</Card>
		</PageShell>
	);
}
