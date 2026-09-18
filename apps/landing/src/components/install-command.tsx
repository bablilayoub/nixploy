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
			aria-label="Copy install command"
			className={cn(
				"group flex max-w-full items-center justify-between gap-4 rounded-lg border border-[#2a2a2e] bg-[#17171a] px-5 py-3 text-left font-mono text-[13px] text-[#e6e6e3] transition-colors hover:border-[#3d3d42]",
				className,
			)}
		>
			<span className="truncate">
				<span className="mr-2 text-[#7d7d85]">$</span>
				<span className="hidden sm:inline">{site.install}</span>
				<span className="sm:hidden">curl …/install.sh | sudo bash</span>
			</span>
			{copied ? (
				<Check className="size-4 shrink-0 text-[#e6e6e3]" />
			) : (
				<Copy className="size-4 shrink-0 text-[#7d7d85] group-hover:text-[#e6e6e3]" />
			)}
		</button>
	);
}
