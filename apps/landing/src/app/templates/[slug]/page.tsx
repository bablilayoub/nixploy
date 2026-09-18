import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InstallCommand } from "@/components/install-command";
import { PageShell, ProseLink } from "@/components/page-shell";
import { site } from "@/lib/site";
import { findTemplate, type TemplateEntry, templateSlugs } from "@/lib/templates";

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

const logoUrl = (logo: string): string =>
	logo.startsWith("http") ? logo : `https://cdn.simpleicons.org/${logo}`;

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

/** One labelled fact in the spec strip. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="border-t border-border py-3">
			<dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
			<dd className="mt-1 text-sm text-foreground">{children}</dd>
		</div>
	);
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
	return (
		<li className="flex gap-4">
			<span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted">
				{n}
			</span>
			<div className="min-w-0">
				<p className="text-sm font-medium text-foreground">{title}</p>
				<p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
			</div>
		</li>
	);
}

export default async function TemplatePage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const template = findTemplate(slug);
	if (!template) notFound();
	return <TemplateBody template={template} />;
}

function TemplateBody({ template }: { template: TemplateEntry }) {
	const generated = template.env.filter((variable) => variable.generated);
	const asked = template.env.filter((variable) => !variable.generated);

	return (
		<PageShell wide>
			<div className="mb-10 flex items-start gap-4">
				{/* biome-ignore lint/performance/noImgElement: remote brand marks from a CDN, no loader configured */}
				<img
					src={logoUrl(template.logo)}
					alt=""
					width={48}
					height={48}
					className="size-12 shrink-0 rounded-lg"
				/>
				<div className="min-w-0">
					<p className="eyebrow">
						<Link href="/templates" className="hover:text-foreground">
							Templates
						</Link>{" "}
						· {template.category}
					</p>
					<h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
						Self-host {template.name}
					</h1>
					<p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">
						<Prose text={template.description} />
					</p>
				</div>
			</div>

			<section className="space-y-4">
				<h2 className="font-display text-xl font-semibold tracking-tight">
					Why self-host {template.name}?
				</h2>
				<p className="text-sm leading-relaxed text-muted">
					Running it yourself means the data lives on a disk you control, there is no per-seat price
					as the team grows, and nothing is retired or repriced by somebody else. The cost is the
					part Nixploy takes over: a reverse proxy, certificates that renew, a volume that survives
					a redeploy, backups you can actually restore, and a way to see the logs when it
					misbehaves.
				</p>
			</section>

			<section className="mt-10">
				<h2 className="font-display text-xl font-semibold tracking-tight">
					Deploy {template.name} with Nixploy
				</h2>
				<p className="mt-3 text-sm text-muted">
					Install Nixploy on any Docker host — a €5 VPS is enough for most of these:
				</p>
				<div className="mt-4">
					<InstallCommand />
				</div>
				<ol className="mt-8 space-y-5">
					<Step n={1} title="Open Templates in the panel">
						Search for {template.name} and open it. The compose file, the variables and the
						suggested domain are already filled in.
					</Step>
					<Step n={2} title="Give it a domain">
						Point a DNS record at your server and enter it. Traefik requests the certificate on the
						first request — there is no separate certbot step and nothing to renew by hand.
					</Step>
					<Step n={3} title="Deploy">
						Nixploy renders the compose file, validates it against the platform's safety rules, and
						brings the stack up on a private per-environment network. Live logs stream while it
						happens.
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
			</section>

			<section className="mt-12">
				<h2 className="font-display text-xl font-semibold tracking-tight">What this deploys</h2>
				<dl className="mt-4 grid gap-x-10 sm:grid-cols-2">
					<Fact label="Images">
						<ul className="space-y-1">
							{template.images.map((image) => (
								<li key={image} className="font-mono text-xs break-all">
									{image}
								</li>
							))}
						</ul>
					</Fact>
					<Fact label="Routed to">
						<span className="font-mono text-xs">
							{template.serviceName}:{template.port}
						</span>
					</Fact>
					{template.volumes.length > 0 ? (
						<Fact label="Persistent volumes">
							<span className="font-mono text-xs">{template.volumes.join(", ")}</span>
						</Fact>
					) : null}
					{asked.length > 0 ? (
						<Fact label="Variables it asks for">
							<ul className="space-y-1.5">
								{asked.map((variable) => (
									<li key={variable.key}>
										<span className="font-mono text-xs">{variable.key}</span>
										<span className="block text-xs text-muted">
											<Prose text={variable.description} />
										</span>
									</li>
								))}
							</ul>
						</Fact>
					) : null}
					{generated.length > 0 ? (
						<Fact label="Secrets Nixploy generates">
							<span className="font-mono text-xs">
								{generated.map((variable) => variable.key).join(", ")}
							</span>
							<span className="mt-1 block text-xs text-muted">
								Created at deploy time and stored encrypted — you never invent or paste them.
							</span>
						</Fact>
					) : null}
					{template.hostPrivileged ? (
						<Fact label="Privileged">
							Needs the Docker socket or elevated capabilities, so only the instance admin can
							deploy it.
						</Fact>
					) : null}
				</dl>
			</section>

			<section className="mt-12">
				<h2 className="font-display text-xl font-semibold tracking-tight">What you get with it</h2>
				<ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
					<li>· Automatic HTTPS through Traefik and Let&apos;s Encrypt, renewed for you.</li>
					<li>· Live logs, a web terminal into the container, and CPU/memory/network history.</li>
					<li>· Encrypted backups to S3 or disk, on a schedule, with verified restores.</li>
					<li>· Roll back to the previous version when an update goes wrong.</li>
					<li>
						· An MCP endpoint, so an AI agent can deploy, read the logs and diagnose it for you —
						see <ProseLink href="/docs/mcp">the MCP guide</ProseLink>.
					</li>
				</ul>
			</section>

			{template.links.website || template.links.docs || template.links.github ? (
				<section className="mt-12 border-t border-border pt-6">
					<h2 className="text-sm font-medium text-foreground">{template.name} upstream</h2>
					<p className="mt-2 text-sm text-muted">
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
					</p>
				</section>
			) : null}
		</PageShell>
	);
}
