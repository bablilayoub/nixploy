"use client";

import { useTheme } from "next-themes";
import { useState } from "react";

import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

/**
 * Simple-icons brands whose default glyph is near-black — invisible on dark
 * surfaces unless we force a light fill via the CDN color segment.
 *
 * Measured, not guessed: every one of these has a relative luminance under
 * 0.035 against the brand colour the CDN paints. Two others in the catalog sit
 * just above that line and keep their own colour on purpose — `duplicati`
 * (#1E3A8A) and `wireguard` (#88171A) are dark but still plainly blue and red.
 */
const DARK_GLYPH_SLUGS = new Set([
	"appsmith",
	"caldotcom",
	"coder",
	"dbeaver",
	"directus",
	"ghost",
	"hoppscotch",
	"karakeep",
	"langflow",
	"matrix",
	"mumble",
	"ollama",
	"outline",
	"owncloud",
	"trilium",
	"umami",
	"vaultwarden",
]);

/**
 * The mirror image: a glyph light enough to disappear against the light-mode
 * tile, which needs a dark fill instead.
 */
const LIGHT_GLYPH_SLUGS = new Set(["radarr"]);

/** Light fill used for dark-glyph icons in dark mode (hex without `#`). */
const DARK_MODE_TINT = "e5e5e5";
/** Dark fill used for light-glyph icons in light mode (hex without `#`). */
const LIGHT_MODE_TINT = "27272a";

const SELFHST_SVG_PREFIX = "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/";

/**
 * Self-hosted-icon marks that declare no fill at all, so they paint pure black
 * and vanish on a dark tile. selfhst ships a `-light` variant of every icon for
 * exactly this case; only these two need it, because the rest carry their own
 * colours and would lose them.
 */
const SELFHST_DARK_GLYPHS = new Set(["heimdall", "infisical"]);

/**
 * Resolve a template `logo` field: absolute URL as-is, otherwise a
 * simple-icons CDN slug (`https://cdn.simpleicons.org/<slug>[/<color>]`).
 */
export function templateLogoSrc(logo: string, darkMode = false): string {
	if (/^https?:\/\//i.test(logo)) {
		if (darkMode && logo.startsWith(SELFHST_SVG_PREFIX)) {
			const name = logo.slice(SELFHST_SVG_PREFIX.length).replace(/\.svg$/, "");
			if (SELFHST_DARK_GLYPHS.has(name)) return `${SELFHST_SVG_PREFIX}${name}-light.svg`;
		}
		return logo;
	}
	if (darkMode && DARK_GLYPH_SLUGS.has(logo)) {
		return `https://cdn.simpleicons.org/${logo}/${DARK_MODE_TINT}`;
	}
	if (!darkMode && LIGHT_GLYPH_SLUGS.has(logo)) {
		return `https://cdn.simpleicons.org/${logo}/${LIGHT_MODE_TINT}`;
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
