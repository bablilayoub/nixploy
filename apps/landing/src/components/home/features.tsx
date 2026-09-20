import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Container, Eyebrow, Pill, SectionHead, TerminalFrame } from "@/components/ui";
import { features } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

/*
 * Three chapters shown, the rest listed.
 *
 * This section used to be twelve equal cells with twelve small icons — a spec
 * sheet, where the reader's eye had nothing to catch on and every claim was
 * worth exactly as much as the next. Now the three that decide whether
 * somebody installs get a numbered chapter each with the real command and its
 * real output, and the remaining nine are a quiet list underneath. A terminal
 * rather than an illustration on purpose: this is a tool whose buyer reads
 * `--help` before a landing page, and the output is the proof.
 *
 * Every command here exists in docs/cli.md. Copy that lies about a flag is
 * worse than no copy at all.
 */

interface Proof {
	/** The feature ids from landing-data this row stands in for. */
	covers: string[];
	eyebrow: string;
	title: string;
	text: string;
	href: string;
	linkText: string;
	terminal: {
		title: string;
		tag: string;
		lines: Array<{ text: string; tone?: "in" | "dim" | "ok" }>;
	};
}

const proofs: Proof[] = [
	{
		covers: ["Git deploys", "Docker Compose stacks", "Rollbacks with config"],
		eyebrow: "Ship",
		title: "Deploy a commit, not a mood",
		text: "Push to GitHub, GitLab, Bitbucket or Gitea, or hand it a Compose file. Every deploy pins the image it ran, so going back is one command and the env goes with it.",
		href: "/docs/deploy",
		linkText: "How deploys work",
		terminal: {
			title: "your machine",
			tag: "cli",
			lines: [
				{ text: "$ nixploy app deploy api --ref v1.4.0 --wait", tone: "in" },
				{ text: "  building   dockerfile · linux/amd64", tone: "dim" },
				{ text: "  rollout    2/2 tasks running", tone: "dim" },
				{ text: "  done in 48s   https://api.acme.dev", tone: "ok" },
			],
		},
	},
	{
		covers: ["Domains and TLS"],
		eyebrow: "Expose",
		title: "A hostname and a certificate, not a Traefik tutorial",
		text: "Attach a domain and Nixploy writes the router, asks Let's Encrypt and attaches the service to the proxy network. Link a DNS provider and the A record is created for you.",
		href: "/docs/domains",
		linkText: "Domains and TLS",
		terminal: {
			title: "your machine",
			tag: "cli",
			lines: [
				{ text: "$ nixploy domain add api.acme.dev --application-id api --https", tone: "in" },
				{ text: "  dns        A api.acme.dev → 203.0.113.10 at Cloudflare", tone: "dim" },
				{ text: "  traefik    router + certificate resolver written", tone: "dim" },
				{ text: "  live       https://api.acme.dev", tone: "ok" },
			],
		},
	},
	{
		covers: ["Monitoring and alerts", "Backups that restore"],
		eyebrow: "Keep it up",
		title: "The log you need is the one from last Tuesday",
		text: "Runtime logs are harvested and searchable after the container is gone. Backups stream to S3 or disk and are restored on a throwaway container to prove they work.",
		href: "/docs/observability",
		linkText: "What it records",
		terminal: {
			title: "your machine",
			tag: "cli",
			lines: [
				{ text: "$ nixploy logs search --app-name shop --query 'level:error'", tone: "in" },
				{ text: "  12:04:11  shop  ECONNREFUSED redis:6379", tone: "dim" },
				{ text: "  12:04:11  shop  retrying in 500ms", tone: "dim" },
				{ text: "  2 lines · searched 41 MB in 180ms", tone: "ok" },
			],
		},
	},
];

const shown = new Set(proofs.flatMap((proof) => proof.covers));

function Terminal({ terminal }: { terminal: Proof["terminal"] }) {
	return (
		<TerminalFrame
			title={terminal.title}
			tag={terminal.tag}
			className="shadow-[0_24px_80px_-48px_#000]"
		>
			<pre className="overflow-x-auto font-mono text-small leading-[2]">
				{terminal.lines.map((line) => (
					<div
						key={line.text}
						className={cn(
							line.tone === "in" && "text-foreground",
							line.tone === "ok" && "text-success",
							(line.tone === "dim" || !line.tone) && "text-muted-2",
						)}
					>
						{line.text}
					</div>
				))}
			</pre>
		</TerminalFrame>
	);
}

export function Features() {
	return (
		<section id="features" className="py-20 lg:py-28">
			<Container>
				<SectionHead
					eyebrow="What it does"
					title="Three things you do on day one"
					lead="Every command below is one from the CLI reference, printed with the output it gives."
					action={
						<Pill href="/features" variant="ghost">
							Every feature
						</Pill>
					}
				/>

				<div className="mt-16 flex flex-col gap-20 lg:mt-20 lg:gap-28">
					{proofs.map((proof, index) => (
						<BlurFade key={proof.title} inView>
							<div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-16">
								{/* The visual leads on the even chapters so the eye crosses the
								    page instead of running down one gutter. */}
								<div className={cn("min-w-0 lg:col-span-5", index % 2 === 1 && "lg:order-2")}>
									{/* The chapter mark: the one accent detail that repeats down the page. */}
									<div className="flex items-center gap-3">
										<span className="font-mono text-micro text-accent-strong tabular-nums">
											{String(index + 1).padStart(2, "0")}
										</span>
										<Eyebrow>{proof.eyebrow}</Eyebrow>
										<span className="h-px flex-1 bg-border" aria-hidden />
									</div>
									<h3 className="mt-5 text-subtitle text-balance text-foreground sm:text-title">
										{proof.title}
									</h3>
									<p className="mt-4 text-body text-muted">{proof.text}</p>
									<Link
										href={proof.href}
										className="mt-6 inline-flex items-center gap-1.5 text-small font-medium text-accent-strong transition-colors hover:text-foreground"
									>
										{proof.linkText}
										<ArrowRight className="size-3.5" aria-hidden />
									</Link>
								</div>
								<div className={cn("min-w-0 lg:col-span-7", index % 2 === 1 && "lg:order-1")}>
									<Terminal terminal={proof.terminal} />
								</div>
							</div>
						</BlurFade>
					))}
				</div>

				{/* Everything the three chapters did not say, at the weight it deserves. */}
				<ul className="mt-20 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:mt-28 lg:grid-cols-3">
					{features
						.filter((feature) => !shown.has(feature.title))
						.map((feature) => (
							<li key={feature.title} className="border-t border-border pt-5">
								<h3 className="text-small font-semibold text-foreground">{feature.title}</h3>
								<p className="mt-2 text-small text-muted">{feature.text}</p>
							</li>
						))}
				</ul>
			</Container>
		</section>
	);
}
