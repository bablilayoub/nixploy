import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Container({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-6", className)}>{children}</div>;
}

export function SectionHeading({
	eyebrow,
	title,
	lede,
	align = "left",
	className,
}: {
	eyebrow?: string;
	title: ReactNode;
	lede?: ReactNode;
	align?: "left" | "center";
	className?: string;
}) {
	return (
		<div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
			{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
			<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
				{title}
			</h2>
			{lede ? <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">{lede}</p> : null}
		</div>
	);
}

type ButtonProps = {
	href: string;
	children: ReactNode;
	variant?: "primary" | "secondary" | "ghost";
	className?: string;
	external?: boolean;
	arrow?: boolean;
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
	primary:
		"bg-foreground text-background hover:bg-accent-strong shadow-[0_0_0_1px_rgba(255,255,255,0.25),0_12px_40px_-14px_rgba(255,255,255,0.45)]",
	secondary:
		"border border-border-strong bg-surface-2/60 text-foreground hover:border-foreground/40 hover:bg-surface-3",
	ghost: "text-muted hover:text-foreground",
};

export function Button({
	href,
	children,
	variant = "primary",
	className,
	external,
	arrow,
}: ButtonProps) {
	const classes = cn(
		"inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-[background,border-color,color,transform] duration-200 active:scale-[0.98]",
		variants[variant],
		className,
	);
	const inner = (
		<>
			{children}
			{arrow ? <ArrowRight className="size-4" /> : null}
		</>
	);
	if (external) {
		return (
			<a href={href} target="_blank" rel="noreferrer" className={classes}>
				{inner}
			</a>
		);
	}
	return (
		<Link href={href} className={classes}>
			{inner}
		</Link>
	);
}

/** App-window frame around a screenshot, with a soft halo behind it. */
export function WindowFrame({
	src,
	alt,
	className,
	priority = false,
}: {
	src: string;
	alt: string;
	className?: string;
	priority?: boolean;
}) {
	return (
		<div className={cn("relative", className)}>
			<div className="halo" aria-hidden />
			<div className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
				<div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
					<span className="size-2.5 rounded-full bg-surface-3" />
					<span className="size-2.5 rounded-full bg-surface-3" />
					<span className="size-2.5 rounded-full bg-surface-3" />
				</div>
				{/* biome-ignore lint/performance/noImgElement: static marketing asset, full-width */}
				<img
					src={src}
					alt={alt}
					className="block w-full grayscale"
					loading={priority ? "eager" : "lazy"}
					decoding="async"
				/>
			</div>
		</div>
	);
}
