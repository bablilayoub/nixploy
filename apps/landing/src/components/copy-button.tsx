"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** A 44px copy control for a code block; announces the copy for a screen reader. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
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
			aria-label="Copy to clipboard"
			className={cn(
				"inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-2 transition-colors hover:bg-surface-3 hover:text-foreground",
				className,
			)}
		>
			{copied ? (
				<Check className="size-4 text-foreground" aria-hidden />
			) : (
				<Copy className="size-4" aria-hidden />
			)}
			<span aria-live="polite" className="sr-only">
				{copied ? "Copied to clipboard" : ""}
			</span>
		</button>
	);
}
