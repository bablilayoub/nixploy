import type { LucideIcon } from "lucide-react";
import { Bot, DatabaseBackup, Lock, RotateCcw, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { InstallCommand } from "@/components/install-command";
import { PageShell, ProseLink } from "@/components/page-shell";
import { brandIconSrc, Card, LearnMore, Panel, Pill, Tile } from "@/components/ui";
import { site } from "@/lib/site";
import { findTemplate, type TemplateEntry, templateCount, templateSlugs } from "@/lib/templates";

export function generateStaticParams() {
	return templateSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const template = findTemplate(slug);
	if (!template) return { title: "Template — Nixploy" };
	const title = `How to self-host ${template.name} on your own server`;
	// Backticks are Markdown for the body, noise in a search result snippet.
	const summary = template.description.replaceAll("`", "");
	return {
		// The root layout appends "· Nixploy"; saying it twice is how the docs
		// pages used to read before the template was added.
		title,
		description: `Deploy ${template.name} on your own VPS in one click with Nixploy: Docker Compose, automatic HTTPS, a persistent volume and backups. ${summary}`,
		alternates: { canonical: `${site.url}/templates/${slug}` },
		openGraph: { title, description: summary, type: "article" },
	};
}

/**
 * Catalog prose is plain text that occasionally uses Markdown backticks for a
 * service name or a shell snippet. The panel shows it raw; a public page
 * should not, so the spans between backticks become `<code>` here rather than
 * editing 11 catalog entries the panel also reads.
 */
function Prose({ text }: { text: string }) {
	return (
		<>
			{text.split("`").map((part, index) =>
				index % 2 === 1 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: split parts of one fixed string
					<code key={index} className="font-mono text-[0.9em] text-foreground">
						{part}
					</code>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: split parts of one fixed string
					<span key={index}>{part}</span>
				),
			)}
		</>
	);
}

/** The template's mark at the size the header tile holds. */
function TemplateMark({ logo }: { logo: string }) {
	return (
		// biome-ignore lint/performance/noImgElement: remote brand marks from a CDN, no loader configured
		<img src={brandIconSrc(logo)} alt="" width={28} height={28} className="size-7" />
	);
}

/*
 * One labelled fact: a mono eyebrow over a mono value, on its own small
 * surface. Padding is set as the two longhands because `Panel` already sets
 * `p-6` and the shorthand is emitted before its own override.
 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Panel tone="surface" className="px-4 py-4">
			<dt className="eyebrow">{label}</dt>
			<dd className="mt-2 font-mono text-micro text-foreground">{children}</dd>
		</Panel>
	);
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
	return (
		<li className="flex gap-4">
			<Tile size={32}>
				<span className="font-mono text-micro text-muted-2">{n}</span>
			</Tile>
			<div className="min-w-0 pt-1">
				<p className="text-body font-medium text-foreground">{title}</p>
				<p className="mt-1 text-small text-muted">{children}</p>
			</div>
		</li>
	);
}

/** What every template gets from the platform around it — the same five lines on all 145 pages. */
const included: { key: string; icon: LucideIcon; text: ReactNode }[] = [
	{
		key: "tls",
		icon: Lock,
		text: "Automatic HTTPS through Traefik and Let's Encrypt, renewed for you.",
	},
	{
		key: "observe",
		icon: ScrollText,
		text: "Live logs, a web terminal into the container, and CPU/memory/network history.",
	},
	{
		key: "backups",
		icon: DatabaseBackup,
		text: "Encrypted backups to S3 or disk, on a schedule, with verified restores.",
	},
	{
		key: "rollback",
		icon: RotateCcw,
		text: "Roll back to the previous version when an update goes wrong.",
	},
	{
		key: "mcp",
		icon: Bot,
		text: (
			<>
				An MCP endpoint, so an AI agent can deploy, read the logs and diagnose it for you — see{" "}
				<ProseLink href="/docs/mcp">the MCP guide</ProseLink>.
			</>
		),
	},
];

export default async function TemplatePage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const template = findTemplate(slug);
	if (!template) notFound();
	return <TemplateBody template={template} />;
}

/*
 * The product-page shape: the mark, the category, "Self-host X", then a pair
 * of big cards (how to deploy it | what the stack is), one full card for what
 * the platform adds, and the self-hosting note. Every fact is read from the
 * generated catalog, so the page cannot describe a stack the panel no longer
 * ships.
 */
function TemplateBody({ template }: { template: TemplateEntry }) {
	const generated = template.env.filter((variable) => variable.generated);
	const asked = template.env.filter((variable) => !variable.generated);
	const hasUpstream = template.links.website || template.links.docs || template.links.github;

	return (
		<PageShell
			icon={<TemplateMark logo={template.logo} />}
			eyebrow={template.category}
			title={`Self-host ${template.name}`}
			description={<Prose text={template.description} />}
			actions={
				<>
					<Pill href="/docs/install" arrow>
						Install Nixploy
					</Pill>
					{template.links.website ? (
						<Pill href={template.links.website} variant="ghost" external>
							Website
						</Pill>
					) : null}
				</>
			}
		>
			<div className="grid gap-4 lg:grid-cols-12">
				<Card className="p-8 sm:p-10 lg:col-span-7">
					<h2 className="text-title text-foreground">Deploy {template.name} with Nixploy</h2>
					<p className="mt-3 text-body text-muted">
						Install Nixploy on any Docker host — a €5 VPS is enough for most of these:
					</p>
					<InstallCommand className="mt-6" />
					<ol className="mt-10 flex flex-col gap-6">
						<Step n={1} title="Open Templates in the panel">
							Search for {template.name} and open it. The compose file, the variables and the
							suggested domain are already filled in.
						</Step>
						<Step n={2} title="Give it a domain">
							Point a DNS record at your server and enter it. Traefik requests the certificate on
							the first request — there is no separate certbot step and nothing to renew by hand.
						</Step>
						<Step n={3} title="Deploy">
							Nixploy renders the compose file, validates it against the platform's safety rules,
							and brings the stack up on a private per-environment network. Live logs stream while
							it happens.
						</Step>
						{template.volumes.length > 0 ? (
							<Step n={4} title="Schedule a backup">
								{template.name} keeps its state in{" "}
								{template.volumes.length === 1 ? "a named volume" : "named volumes"} (
								{template.volumes.join(", ")}). Add a schedule and Nixploy streams the dump to S3 or
								to disk, encrypted, and can verify a restore.
							</Step>
						) : null}
					</ol>
				</Card>

				<Card className="p-8 sm:p-10 lg:col-span-5">
					<h2 className="text-title text-foreground">What this deploys</h2>
					<dl className="mt-6 flex flex-col gap-3">
						<Fact label="Images">
							<ul className="flex flex-col gap-1">
								{template.images.map((image) => (
									<li key={image} className="break-all">
										{image}
									</li>
								))}
							</ul>
						</Fact>
						<Fact label="Routed to">
							{template.serviceName}:{template.port}
						</Fact>
						{template.volumes.length > 0 ? (
							<Fact label="Persistent volumes">{template.volumes.join(", ")}</Fact>
						) : null}
						{asked.length > 0 ? (
							<Fact label="Variables it asks for">
								<ul className="flex flex-col gap-2">
									{asked.map((variable) => (
										<li key={variable.key}>
											{variable.key}
											<span className="mt-0.5 block font-sans text-muted">
												<Prose text={variable.description} />
											</span>
										</li>
									))}
								</ul>
							</Fact>
						) : null}
						{generated.length > 0 ? (
							<Fact label="Secrets Nixploy generates">
								{generated.map((variable) => variable.key).join(", ")}
								<span className="mt-1 block font-sans text-muted">
									Created at deploy time and stored encrypted — you never invent or paste them.
								</span>
							</Fact>
						) : null}
						{template.hostPrivileged ? (
							<Fact label="Privileged">
								<span className="font-sans">
									Needs the Docker socket or elevated capabilities, so only the instance admin can
									deploy it.
								</span>
							</Fact>
						) : null}
					</dl>
				</Card>
			</div>

			{template.domains && template.domains.length > 0 ? (
				<Card className="mt-4 p-8 sm:p-10">
					<h2 className="text-title text-foreground">Domains from your values</h2>
					<p className="mt-2 text-small text-muted">
						Attached to the stack on deploy, straight from the env values you enter — and, with
						automatic DNS records on, created at your DNS provider too.
					</p>
					<ul className="mt-6 flex flex-col gap-2 font-mono text-small text-foreground">
						{template.domains.map((hint) => (
							<li key={`${hint.env}-${hint.port}`}>
								{hint.wildcard ? "*." : ""}
								{"{"}
								{hint.env}
								{"}"} → {hint.serviceName}:{hint.port}
								<span className="text-muted">
									{hint.https === false ? " · HTTP" : " · HTTPS"}
									{hint.wildcard ? " · wildcard" : ""}
								</span>
							</li>
						))}
					</ul>
				</Card>
			) : null}

			{template.setup && template.setup.length > 0 ? (
				<Card className="mt-4 p-8 sm:p-10">
					<h2 className="text-title text-foreground">Set it up</h2>
					<p className="mt-2 text-small text-muted">
						What to do once the stack is deployed, in order. The panel shows the same steps on the
						template's details.
					</p>
					<ol className="mt-6 flex list-decimal flex-col gap-3 pl-5 text-small text-foreground">
						{template.setup.map((step) => (
							<li key={step}>
								<Prose text={step} />
							</li>
						))}
					</ol>
				</Card>
			) : null}

			<Card className="mt-4 p-8 sm:p-10">
				<h2 className="text-title text-foreground">What you get with it</h2>
				<ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
					{included.map(({ key, icon: Icon, text }) => (
						<li key={key} className="flex flex-col gap-4">
							<Tile size={40}>
								<Icon className="size-5" aria-hidden />
							</Tile>
							<p className="text-small text-muted">{text}</p>
						</li>
					))}
				</ul>
			</Card>

			<div className="mt-4 grid gap-4 lg:grid-cols-2">
				<Panel className="p-8">
					<h2 className="text-subtitle text-foreground">Why self-host {template.name}?</h2>
					<p className="mt-3 text-body text-muted">
						Running it yourself means the data lives on a disk you control, there is no per-seat
						price as the team grows, and nothing is retired or repriced by somebody else. The cost
						is the part Nixploy takes over: a reverse proxy, certificates that renew, a volume that
						survives a redeploy, backups you can actually restore, and a way to see the logs when it
						misbehaves.
					</p>
				</Panel>
				<Panel className="flex flex-col p-8">
					<h2 className="text-subtitle text-foreground">{template.name} upstream</h2>
					<p className="mt-3 flex-1 text-body text-muted">
						{hasUpstream ? (
							<>
								Nixploy packages the project; it is not affiliated with it.{" "}
								{template.links.website ? (
									<>
										<ProseLink href={template.links.website}>Website</ProseLink>
										{template.links.docs || template.links.github ? " · " : ""}
									</>
								) : null}
								{template.links.docs ? (
									<>
										<ProseLink href={template.links.docs}>Docs</ProseLink>
										{template.links.github ? " · " : ""}
									</>
								) : null}
								{template.links.github ? (
									<ProseLink href={template.links.github}>Source</ProseLink>
								) : null}
							</>
						) : (
							"Nixploy packages the project; it is not affiliated with it."
						)}
					</p>
					<div className="mt-6">
						<LearnMore href="/templates">All {templateCount} templates</LearnMore>
					</div>
				</Panel>
			</div>
		</PageShell>
	);
}
