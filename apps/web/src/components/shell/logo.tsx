import { cn } from "@/lib/utils";

/**
 * Nixploy mark: a rounded-square badge with three stacked bars knocked out —
 * a nod to layered deploy stacks. The bars are mask cutouts, so the mark
 * works on any background in both themes.
 */
export function LogoMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-label="Nixploy"
			className={cn("size-5", className)}
		>
			<mask id="nixploy-mark-bars">
				<rect x="2" y="2" width="20" height="20" rx="5" fill="white" />
				<rect x="6" y="6.75" width="12" height="2.5" rx="1.25" fill="black" />
				<rect x="6" y="10.75" width="9" height="2.5" rx="1.25" fill="black" />
				<rect x="6" y="14.75" width="6" height="2.5" rx="1.25" fill="black" />
			</mask>
			<rect x="2" y="2" width="20" height="20" rx="5" mask="url(#nixploy-mark-bars)" />
		</svg>
	);
}

export function Logo({ className }: { className?: string }) {
	return (
		<span className={cn("flex items-center gap-2", className)}>
			<LogoMark />
			<span className="text-sm font-semibold tracking-tight">Nixploy</span>
		</span>
	);
}
