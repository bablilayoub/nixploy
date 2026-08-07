import Image from "next/image";

import { cn } from "@/lib/utils";

/** Public path for the Nixploy cheetah mark (apps/web/public/brand). */
export const NIXPLOY_MARK_SRC = "/brand/nixploy-mark.png";

/**
 * Nixploy mark: amber cheetah head — speed / precise deploys.
 * Raster brand asset; use with the wordmark via `<Logo />`.
 */
export function LogoMark({ className }: { className?: string }) {
	return (
		<span
			className={cn("relative inline-flex size-5 shrink-0 overflow-hidden rounded-md", className)}
		>
			<Image
				src={NIXPLOY_MARK_SRC}
				alt="Nixploy"
				width={80}
				height={80}
				className="size-full object-cover"
				priority
			/>
		</span>
	);
}

export function Logo({ className }: { className?: string }) {
	return (
		<span className={cn("flex items-center gap-2", className)}>
			<LogoMark className="size-6" />
			<span className="text-sm font-semibold tracking-tight">Nixploy</span>
		</span>
	);
}
