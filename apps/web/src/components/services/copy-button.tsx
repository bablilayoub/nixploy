"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function CopyButton({ value, label }: { value: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Failed to copy to clipboard");
		}
	};

	if (label) {
		return (
			<Button variant="outline" size="sm" onClick={copy}>
				{copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
				{label}
			</Button>
		);
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon-sm" onClick={copy}>
					{copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
		</Tooltip>
	);
}
