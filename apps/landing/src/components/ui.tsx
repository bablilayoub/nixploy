import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * The whole landing page is built from these four primitives. Every section is
 * a <Section>, every section opens with a <SectionHeading>, every panel is a
 * <Card>. Keeping the vocabulary this small is what makes the page read as one
 * document rather than ten separately designed blocks — add a variant here
 * rather than a one-off className in a section.
 */

export function Container({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>{children}</div>;
}

/** One section: a hairline rule, one vertical rhythm, one container. */
export function Section({
	children,
	id,
	className,
	divider = true,
}: {
	children: ReactNode;
	id?: string;
	className?: string;
	divider?: boolean;
}) {
	return (
		<section
			id={id}
			className={cn("py-20 sm:py-28", divider && "border-t border-border", className)}
		>
			<Container>{children}</Container>
		</section>
	);
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
			<h2 className="mt-3 font-display text-[1.9rem] leading-[1.15] font-semibold tracking-tight text-balance text-foreground sm:text-[2.5rem]">
				{title}
			</h2>
			{lede ? (
				<p className="mt-4 text-[15px] leading-relaxed text-muted sm:text-base">{lede}</p>
			) : null}
		</div>
	);
}

export function Card({
	children,
	className,
	as: Tag = "div",
}: {
	children: ReactNode;
	className?: string;
	as?: "div" | "li" | "article";
}) {
	return (
		<Tag
			className={cn(
				"rounded-xl border border-border bg-surface/60 p-6 transition-colors duration-200 hover:border-border-strong",
				className,
			)}
		>
			{children}
		</Tag>
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
	primary: "bg-foreground text-background hover:bg-foreground/90",
	secondary: "border border-border-strong text-foreground hover:bg-surface-2",
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
		"inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium transition-colors duration-200",
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

/**
 * App-window frame around a real capture of the panel.
 *
 * Screenshots are desaturated by default: the panel uses green, red and blue
 * for status and charts, and this site is strictly monochrome. The capture
 * stays honest — only its saturation is dropped — and dark UI greyscales
 * cleanly. Pass `color` only if a shot genuinely needs its hues.
 */
export function WindowFrame({
	src,
	alt,
	className,
	priority = false,
	color = false,
}: {
	src: string;
	alt: string;
	className?: string;
	priority?: boolean;
	color?: boolean;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border border-border bg-surface",
				"shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset,0_40px_90px_-50px_rgba(0,0,0,1)]",
				className,
			)}
		>
			<div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
				<span className="size-2.5 rounded-full bg-surface-3" />
				<span className="size-2.5 rounded-full bg-surface-3" />
				<span className="size-2.5 rounded-full bg-surface-3" />
			</div>
			{/* biome-ignore lint/performance/noImgElement: static marketing asset, full-width */}
			<img
				src={src}
				alt={alt}
				className={cn("block w-full", !color && "grayscale")}
				loading={priority ? "eager" : "lazy"}
				decoding="async"
			/>
		</div>
	);
}
