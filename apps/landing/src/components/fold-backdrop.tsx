import { AnimatedGridPattern } from "@/components/magicui/animated-grid-pattern";
import { cn } from "@/lib/utils";

/*
 * The fold's backdrop: graph paper that dies out towards the edges, and one
 * soft glow behind the heading so the grid reads as depth rather than as a
 * texture. It was written for the home page and lived inside the hero, which
 * is why every other page looked like a different site — same tokens, same
 * type, but a flat black fold. One definition, two volumes.
 *
 * `hero` is the home fold: 900px of grid and a wide glow under a 4.5rem
 * title. `page` is every other header — shorter, dimmer, fewer lit squares,
 * because an inner page's heading is half the size and the grid must not
 * out-shout it.
 *
 * Purely decorative, so `aria-hidden`; `overflow-hidden` keeps the glow off
 * the horizontal scrollbar on a narrow window, and the grid draws without
 * any lit squares under `prefers-reduced-motion` (see AnimatedGridPattern).
 */
export function FoldBackdrop({
	variant = "page",
	className,
}: {
	variant?: "hero" | "page";
	className?: string;
}) {
	const hero = variant === "hero";
	return (
		<div
			className={cn(
				"pointer-events-none absolute inset-x-0 top-0 overflow-hidden",
				hero ? "h-[900px]" : "h-[620px]",
				className,
			)}
			aria-hidden
		>
			<AnimatedGridPattern
				numSquares={hero ? 24 : 16}
				maxOpacity={hero ? 0.12 : 0.08}
				className="[mask-image:radial-gradient(ellipse_70%_80%_at_50%_0%,#000_25%,transparent_100%)] text-foreground"
			/>
			<div
				className={cn(
					"absolute top-0 left-1/2 -translate-x-1/2 rounded-full",
					hero
						? "h-[560px] w-[900px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.07),transparent_65%)]"
						: "h-[420px] w-[760px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.05),transparent_65%)]",
				)}
			/>
		</div>
	);
}
