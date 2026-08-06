import Link from "next/link";
import { Cta, Footer } from "@/components/cta";
import { Navbar } from "@/components/navbar";

export function ProseLink({ href, children }: { href: string; children: React.ReactNode }) {
	const external = href.startsWith("http");
	const className = "text-white underline decoration-white/30 underline-offset-4 hover:decoration-white";
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
}: {
	children: React.ReactNode;
	eyebrow?: string;
	title?: string;
	description?: string;
}) {
	return (
		<div className="flex min-h-screen flex-col bg-[#050505]">
			<Navbar />
			<main className="relative flex-1 pb-16">
				<div className="relative mx-auto max-w-3xl px-5 pt-28 sm:px-6 sm:pt-36">
					{title && (
						<div className="mb-12">
							{eyebrow && (
								<p className="mb-3 font-mono text-xs tracking-[0.2em] text-neutral-500 uppercase">
									{eyebrow}
								</p>
							)}
							<h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
								{title}
							</h1>
							{description && (
								<p className="mt-4 max-w-2xl text-lg text-neutral-400">{description}</p>
							)}
						</div>
					)}
					{children}
				</div>
			</main>
			<Cta />
			<Footer />
		</div>
	);
}
