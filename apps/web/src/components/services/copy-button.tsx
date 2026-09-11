"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Clipboard button with an accessible name and a 1.5 s "copied" tick.
 * Icon-only by default (next to read-only inputs); `showLabel` renders the
 * label as visible text for standalone buttons ("Copy link").
 */
export function CopyButton({
	value,
	label = "Copy",
	variant,
	showLabel = false,
	className,
}: {
	value: string;
	label?: string;
	variant?: "ghost" | "outline";
	showLabel?: boolean;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Failed to copy — select the text and copy it manually");
		}
	};
	if (showLabel) {
		return (
			<Button
				type="button"
				variant={variant ?? "outline"}
				size="sm"
				className={cn("shrink-0", className)}
				onClick={copy}
			>
				{copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
				{copied ? "Copied" : label}
			</Button>
		);
	}
	return (
		<Button
			type="button"
			variant={variant ?? "ghost"}
			size="icon"
			className={cn("size-7 shrink-0", className)}
			aria-label={copied ? "Copied" : label}
			title={label}
			onClick={copy}
		>
			{copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
		</Button>
	);
}
