"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

/*
 * The install one-liner as a command cell: 44px tall like the button beside
 * it, mono, copy control flush right. It plays the role a "copy script"
 * button component would — the whole cell is the button.
 */
export function InstallCommand({ className }: { className?: string }) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(site.install);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1200);
		} catch {
			/* clipboard unavailable */
		}
	}

	return (
		<button
			type="button"
			onClick={copy}
			aria-label="Copy install command"
			className={cn(
				"group flex h-11 w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-surface pr-1.5 pl-4 text-left font-mono text-micro text-foreground transition-colors hover:border-border-strong hover:bg-surface-2",
				className,
			)}
		>
			<span className="min-w-0 flex-1 truncate">
				<span className="mr-2 text-muted-2">$</span>
				<span className="hidden sm:inline">{site.install}</span>
				<span className="sm:hidden">curl -fsSL …/install.sh | sudo bash</span>
			</span>
			<span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors group-hover:bg-surface-3 group-hover:text-foreground">
				{copied ? <Check className="size-4 text-foreground" /> : <Copy className="size-4" />}
			</span>
			{/* The icon swap is the only feedback a sighted user gets; say it out loud too. */}
			<span aria-live="polite" className="sr-only">
				{copied ? "Install command copied to clipboard" : ""}
			</span>
		</button>
	);
}
