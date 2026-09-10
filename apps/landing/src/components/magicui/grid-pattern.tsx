import { cn } from "@/lib/utils";

/** Decorative SVG grid with a radial mask, meant to sit behind a section. */
export function GridPattern({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={cn(
				"bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_30%,transparent_75%)]",
				className,
			)}
		/>
	);
}
