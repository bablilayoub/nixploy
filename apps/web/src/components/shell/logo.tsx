import Image from "next/image";

import { cn } from "@/lib/utils";

/** Dark mark (for light UI backgrounds). */
export const NIXPLOY_MARK_DARK_SRC = "/brand/nixploy-mark-dark.png";
/** Light mark (for dark UI backgrounds). */
export const NIXPLOY_MARK_LIGHT_SRC = "/brand/nixploy-mark-light.png";
/**
 * Nixploy cheetah mark — theme-aware (dark mark in light mode, light mark in dark mode).
 */
export function LogoMark({ className }: { className?: string }) {
	return (
		<span
			className={cn("relative inline-flex size-5 shrink-0 overflow-hidden rounded-md", className)}
		>
			<Image
				src={NIXPLOY_MARK_DARK_SRC}
				alt="Nixploy"
				width={80}
				height={80}
				className="size-full object-cover dark:hidden"
				priority
			/>
			<Image
				src={NIXPLOY_MARK_LIGHT_SRC}
				alt=""
				width={80}
				height={80}
				className="hidden size-full object-cover dark:block"
				priority
				aria-hidden
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
