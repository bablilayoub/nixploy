"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { BorderBeam } from "@/components/magicui/border-beam";
import { site } from "@/lib/site";

export function InstallCommand({ className = "" }: { className?: string }) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(site.install);
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			/* clipboard unavailable */
		}
	};

	return (
		<button
			type="button"
			onClick={copy}
			className={`group relative flex max-w-full items-center justify-between gap-4 overflow-hidden rounded-lg border border-white/10 bg-black px-4 py-3 font-mono text-[13px] text-neutral-300 ${className}`}
		>
			<BorderBeam size={60} duration={8} colorFrom="#fff" colorTo="#525252" />
			<span className="truncate text-left">
				<span className="mr-2 text-neutral-600">$</span>
				<span className="hidden sm:inline">{site.install}</span>
				<span className="sm:hidden">curl …/install.sh | sudo bash</span>
			</span>
			{copied ? (
				<Check className="size-4 shrink-0 text-white" />
			) : (
				<Copy className="size-4 shrink-0 text-neutral-500 group-hover:text-white" />
			)}
		</button>
	);
}
