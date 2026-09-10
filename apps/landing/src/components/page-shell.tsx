import Link from "next/link";

import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { site } from "@/lib/site";

export function ProseLink({ href, children }: { href: string; children: React.ReactNode }) {
	const external = href.startsWith("http");
	const className =
		"text-foreground underline decoration-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground";
	if (external) {
		return (
			<a href={href} target="_blank" rel="noreferrer" className={className}>
				{children}
			</a>
		);
	}
	return (
		<Link href={href} className={className}>
			{children}
		</Link>
	);
}

export function PageShell({
	children,
	eyebrow,
	title,
	description,
	wide = false,
}: {
	children: React.ReactNode;
	eyebrow?: string;
	title?: string;
	description?: string;
	wide?: boolean;
}) {
	return (
		<div className="relative flex min-h-screen flex-col bg-atmosphere">
			<div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />
			<Navbar />
			<main className="relative flex-1 pb-20">
				<div
					className={`relative mx-auto px-5 pt-28 sm:px-6 sm:pt-36 ${wide ? "max-w-5xl" : "max-w-3xl"}`}
				>
					{title ? (
						<div className="mb-12">
							{eyebrow ? <p className="mb-3 eyebrow">{eyebrow}</p> : null}
							<h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
								{title}
							</h1>
							{description ? (
								<p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">{description}</p>
							) : null}
						</div>
					) : null}
					{children}
				</div>
			</main>
			<section className="relative border-t border-border">
				<div className="mx-auto max-w-6xl px-5 py-16 text-center sm:px-6 sm:py-20">
					<h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
						Install Nixploy on your metal
					</h2>
					<p className="mx-auto mt-3 max-w-lg text-muted">
						One command. Docker Swarm, Traefik, and the panel — yours.
					</p>
					<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
						<Link
							href="/docs/install"
							className="inline-flex h-11 items-center rounded-md bg-accent px-5 text-sm font-medium text-[#14100a] transition-colors hover:bg-accent-strong"
						>
							Install guide
						</Link>
						<a
							href={site.github}
							target="_blank"
							rel="noreferrer"
							className="inline-flex h-11 items-center rounded-md border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
						>
							Star on GitHub
						</a>
					</div>
				</div>
			</section>
			<Footer />
		</div>
	);
}
