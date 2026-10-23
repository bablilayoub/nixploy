"use client";
import { useState } from "react";
import { brandIconSrc, isNeutralBrandMark } from "@/lib/brand";
import { cn } from "@/lib/utils";
export function TemplateLogo({
	logo,
	name,
	size = "default",
}: {
	logo: string;
	name: string;
	size?: "default" | "hero";
}) {
	const [failed, setFailed] = useState(false);
	return (
		<span
			className={cn(
				"relative inline-grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-background font-mono text-sm text-muted-foreground",
				size === "hero" && "reference-inline-mark",
			)}
			aria-hidden="true"
		>
			{failed && (
				<span className={size === "hero" ? "text-[.35em]" : undefined}>{name.slice(0, 1)}</span>
			)}
			{!failed && (
				// biome-ignore lint/performance/noImgElement: upstream SVG marks use an existing CDN; no image optimizer is needed
				<img
					src={brandIconSrc(logo)}
					alt=""
					width={24}
					height={24}
					loading={size === "hero" ? "eager" : "lazy"}
					onError={() => setFailed(true)}
					className={cn(
						"absolute size-6 bg-background object-contain",
						isNeutralBrandMark(logo) && "invert dark:invert-0",
					)}
				/>
			)}
		</span>
	);
}
