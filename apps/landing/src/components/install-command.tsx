"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

export function InstallCommand({ className }: { className?: string }) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(site.install);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {
			/* clipboard unavailable */
		}
	}

	return (
		<button
			type="button"
			onClick={copy}
			className={cn(
				"group flex max-w-full items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3 font-mono text-[13px] text-foreground/90 transition-colors hover:border-foreground/40",
				className,
			)}
		>
			<span className="truncate text-left">
				<span className="mr-2 text-muted">$</span>
				<span className="hidden sm:inline">{site.install}</span>
				<span className="sm:hidden">curl …/install.sh | sudo bash</span>
			</span>
			{copied ? (
				<Check className="size-4 shrink-0 text-muted" />
			) : (
				<Copy className="size-4 shrink-0 text-muted group-hover:text-foreground" />
			)}
		</button>
	);
}
