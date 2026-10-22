"use client";
import { Check, Copy, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { site } from "@/lib/site";
export function InstallCommand() {
	const [copied, setCopied] = useState(false),
		[failed, setFailed] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	async function copy() {
		try {
			await navigator.clipboard.writeText(site.install);
			setCopied(true);
			setFailed(false);
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), 2200);
		} catch {
			setFailed(true);
		}
	}
	return (
		<div className="install-command">
			<div className="install-command-title">
				<span className="inline-flex items-center gap-2">
					<Terminal className="size-4" aria-hidden="true" />
					One command. Your own platform.
				</span>
				<button
					type="button"
					onClick={() => void copy()}
					aria-label={copied ? "Install command copied" : "Copy install command"}
				>
					{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
				</button>
			</div>
			<pre
				// biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll the command
				tabIndex={0}
			>
				<code>
					<span aria-hidden="true" className="text-primary">
						${" "}
					</span>
					{site.install}
				</code>
			</pre>
			<span
				role="status"
				className={failed ? "block px-4 pb-3 text-sm text-muted-foreground" : "sr-only"}
			>
				{failed
					? "Copy unavailable. Select and copy the command above."
					: copied
						? "Command copied"
						: ""}
			</span>
		</div>
	);
}
