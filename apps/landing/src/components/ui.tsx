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
		"bg-accent text-[#14100a] hover:bg-accent-strong shadow-[0_0_0_1px_rgba(242,181,61,0.4),0_12px_40px_-12px_rgba(242,181,61,0.55)]",
	secondary:
		"border border-border-strong bg-surface-2 text-foreground hover:border-accent/50 hover:bg-surface-3",
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
		"inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium transition-[background,border-color,color,transform] duration-200 active:scale-[0.98]",
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

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted",
				className,
			)}
		>
			{children}
		</span>
	);
}
