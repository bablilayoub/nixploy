"use client";

import Image from "next/image";

import { useBranding } from "@/components/branding-provider";
import { cn } from "@/lib/utils";

/** Dark mark (for light UI backgrounds). */
export const NIXPLOY_MARK_DARK_SRC = "/brand/nixploy-mark-dark.png";
/** Light mark (for dark UI backgrounds). */
export const NIXPLOY_MARK_LIGHT_SRC = "/brand/nixploy-mark-light.png";

/**
 * The instance's mark — theme-aware (dark mark on light backgrounds and the
 * reverse), falling back to Nixploy's cheetah.
 *
 * An operator who uploads only one logo gets it in both themes: a single mark
 * that works on one background is still better than the wrong product's mark
 * on the other.
 */
export function LogoMark({ className }: { className?: string }) {
	const branding = useBranding();
	const light = branding.logoLightUrl ?? branding.logoDarkUrl;
	const dark = branding.logoDarkUrl ?? branding.logoLightUrl;
	const custom = Boolean(light || dark);

	return (
		<span
			className={cn("relative inline-flex size-5 shrink-0 overflow-hidden rounded-md", className)}
		>
			<Image
				src={light ?? NIXPLOY_MARK_DARK_SRC}
				alt={branding.productName}
				width={80}
				height={80}
				className="size-full object-contain dark:hidden"
				// An uploaded asset is served from our own origin but is not a
				// build-time import, so Next's optimiser has nothing to work with.
				unoptimized={custom}
				priority
			/>
			<Image
				src={dark ?? NIXPLOY_MARK_LIGHT_SRC}
				alt=""
				width={80}
				height={80}
				className="hidden size-full object-contain dark:block"
				unoptimized={custom}
				priority
				aria-hidden
			/>
		</span>
	);
}

export function Logo({ className }: { className?: string }) {
	const branding = useBranding();
	return (
		<span className={cn("flex items-center gap-2", className)}>
			<LogoMark className="size-6" />
			<span className="text-sm font-semibold tracking-tight">{branding.productName}</span>
		</span>
	);
}
