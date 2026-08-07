"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { site } from "@/lib/site";

export function InstallSection() {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(site.install);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {
			/* ignore */
		}
	}

	return (
		<section id="install" className="border-t border-border py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<div className="max-w-xl">
					<p className="font-mono text-xs tracking-[0.18em] text-amber uppercase">Install</p>
					<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
						One command on your host.
					</h2>
					<p className="mt-4 text-muted">
						Linux with root, Docker-ready. Full options on the{" "}
						<a
							href="/install"
							className="text-amber-soft underline decoration-amber/40 underline-offset-4"
						>
							install guide
						</a>
						.
					</p>
				</div>

				<div className="mt-10 overflow-hidden rounded-lg border border-border bg-surface">
					<div className="flex items-center justify-between border-b border-border px-4 py-3">
						<span className="font-mono text-xs text-muted">bash</span>
						<button
							type="button"
							onClick={copy}
							className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
						>
							{copied ? <Check className="size-3.5 text-amber" /> : <Copy className="size-3.5" />}
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
					<pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-foreground/90">
						{site.install}
					</pre>
				</div>
			</div>
		</section>
	);
}
