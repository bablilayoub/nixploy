"use client";

import { useTheme } from "next-themes";
import { useState } from "react";

import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

/**
 * Simple-icons brands whose default glyph is near-black — invisible on dark
 * surfaces unless we force a light fill via the CDN color segment.
 */
const DARK_GLYPH_SLUGS = new Set([
	"ollama",
	"umami",
	"caldotcom",
	"mumble",
	"matrix",
	"hoppscotch",
	"karakeep",
	"outline",
	"coder",
	"vaultwarden",
	"ghost",
]);

/** Light fill used for dark-glyph icons in dark mode (hex without `#`). */
const DARK_MODE_TINT = "e5e5e5";

/**
 * Resolve a template `logo` field: absolute URL as-is, otherwise a
 * simple-icons CDN slug (`https://cdn.simpleicons.org/<slug>[/<color>]`).
 */
export function templateLogoSrc(logo: string, darkMode = false): string {
	if (/^https?:\/\//i.test(logo)) return logo;
	if (darkMode && DARK_GLYPH_SLUGS.has(logo)) {
		return `https://cdn.simpleicons.org/${logo}/${DARK_MODE_TINT}`;
	}
	return `https://cdn.simpleicons.org/${logo}`;
}

export function TemplateLogo({
	name,
	logo,
	className,
	fallbackClassName,
}: {
	name: string;
	logo: string;
	className?: string;
	fallbackClassName?: string;
}) {
	const { resolvedTheme } = useTheme();
	const mounted = useMounted();
	const [failed, setFailed] = useState(false);

	// Avoid SSR/client theme mismatch: render the light-mode URL until mounted.
	const darkMode = mounted && resolvedTheme === "dark";

	if (failed || !logo) {
		return (
			<span
				className={cn(
					"flex size-full items-center justify-center text-sm font-semibold uppercase text-muted-foreground",
					fallbackClassName,
					className,
				)}
			>
				{name.charAt(0)}
			</span>
		);
	}
	return (
		// biome-ignore lint/performance/noImgElement: remote brand logos (simple-icons or project assets); next/image would need remotePatterns
		<img
			key={`${logo}-${darkMode ? "dark" : "light"}`}
			src={templateLogoSrc(logo, darkMode)}
			alt=""
			className={cn("size-5 object-contain", className)}
			onError={() => setFailed(true)}
		/>
	);
}
