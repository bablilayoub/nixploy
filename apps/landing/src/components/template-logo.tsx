"use client";
import { useState } from "react";
import { brandIconSrc } from "@/lib/brand";
export function TemplateLogo({ logo, name }: { logo: string; name: string }) {
	const [failed, setFailed] = useState(false);
	return (
		<span
			className="relative inline-grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border bg-background font-mono text-sm text-muted-foreground"
			aria-hidden="true"
		>
			{name.slice(0, 1)}
			{!failed && (
				// biome-ignore lint/performance/noImgElement: upstream SVG marks use an existing CDN; no image optimizer is needed
				<img
					src={brandIconSrc(logo)}
					alt=""
					width={24}
					height={24}
					loading="lazy"
					onError={() => setFailed(true)}
					className="absolute size-6 bg-background object-contain"
				/>
			)}
		</span>
	);
}
