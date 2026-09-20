import type { LucideIcon } from "lucide-react";
import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode, SVGProps } from "react";

import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/*
 * The vocabulary the home page is built from: one column, big rounded cards,
 * white pill buttons, an accent text link, a mono strip caption, a rounded
 * icon tile. Values live in globals.css (`.sheet`, `.card`, `.eyebrow`);
 * these are the elements that use them. Keep the set small.
 */

/** The 1280px column everything measures from. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("sheet", className)}>{children}</div>;
}

/** A big home-page card: one surface up, 32px corners, no border. */
export function Card({
	children,
	className,
	href,
	external,
	label,
}: {
	children: ReactNode;
	className?: string;
	/** Makes the whole card a link. */
	href?: string;
	external?: boolean;
	/** Accessible name of a linked card, so a screen reader does not read the whole card as the link. */
	label?: string;
}) {
	const classes = cn(
		"card overflow-hidden",
		href && "transition-colors duration-200 hover:bg-surface-2",
		className,
	);
	if (href && external) {
		return (
			<a
				href={href}
				target="_blank"
				rel="noreferrer"
				className={cn(classes, "block")}
				aria-label={label}
			>
				{children}
			</a>
		);
	}
	if (href) {
		return (
			<Link href={href} className={cn(classes, "block")} aria-label={label}>
				{children}
			</Link>
		);
	}
	return <div className={classes}>{children}</div>;
}

type PillProps = {
	href: string;
	children: ReactNode;
	variant?: "primary" | "ghost" | "outline";
	size?: "sm" | "md" | "lg";
	/** Trailing arrow, for the page's conversion actions. */
	arrow?: boolean;
	/** Leading icon component (a lucide icon or one from `@/components/icons`). */
	icon?: ComponentType<SVGProps<SVGSVGElement>>;
	className?: string;
	external?: boolean;
};

const pillVariants: Record<NonNullable<PillProps["variant"]>, string> = {
	primary: "bg-foreground text-background hover:bg-white",
	ghost: "bg-surface-3 text-foreground hover:bg-border",
	outline: "border border-border-strong text-foreground hover:bg-surface",
};

const pillSizes: Record<NonNullable<PillProps["size"]>, string> = {
	// 44px on phones, where the pill is the tap target; the desktop heights are the reference's.
	sm: "h-9 px-4 text-small max-sm:h-11",
	md: "h-10 px-4 text-small max-sm:h-11",
	lg: "h-12 px-6 text-body",
};

/*
 * Pill buttons. White is the conversion action and appears with the same
 * words in the nav, the fold and the closing card; ghost sits beside it;
 * outline is for the nav's secondary action and small in-figure controls.
 */
export function Pill({
	href,
	children,
	variant = "primary",
	size = "md",
	arrow = false,
	icon: Icon,
	className,
	external,
}: PillProps) {
	const classes = cn(
		"inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors duration-200",
		pillVariants[variant],
		pillSizes[size],
		className,
	);
	const inner = (
		<>
			{Icon ? <Icon className="size-4" aria-hidden /> : null}
			{children}
			{arrow ? <ArrowRight className="size-4" aria-hidden /> : null}
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

/** The accent text link under a feature card: "Learn more ›". */
export function LearnMore({
	href,
	children = "Learn more",
	className,
	external,
	label,
}: {
	href: string;
	children?: ReactNode;
	className?: string;
	external?: boolean;
	/** Accessible name when the visible text repeats across a page ("Learn more" ×6). */
	label?: string;
}) {
	// Vertical padding pulled back with a negative margin: a 44px target that sits on the text's baseline.
	const classes = cn(
		"group -my-2.5 inline-flex min-h-11 items-center gap-1 py-2.5 text-body font-medium text-accent-strong transition-colors hover:text-foreground",
		className,
	);
	const inner = (
		<>
			{children}
			<ChevronRight
				className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
				aria-hidden
			/>
		</>
	);
	if (external) {
		return (
			<a href={href} target="_blank" rel="noreferrer" className={classes} aria-label={label}>
				{inner}
			</a>
		);
	}
	return (
		<Link href={href} className={classes} aria-label={label}>
			{inner}
		</Link>
	);
}

/** The one uppercase style on the site: a 13px mono strip caption. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
	return <p className={cn("eyebrow", className)}>{children}</p>;
}

/** A centred section heading: 48px, optional two-line sub in muted. */
export function SectionTitle({
	title,
	children,
	className,
}: {
	title: string;
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("mx-auto max-w-[40rem] text-center", className)}>
			<h2 className="text-title text-balance text-foreground sm:text-headline">{title}</h2>
			{children ? <p className="mt-4 text-lead text-balance text-muted">{children}</p> : null}
		</div>
	);
}

/*
 * The home page's section header: a mono eyebrow, one heading, one optional
 * line, and an optional action parked on the right at desktop width.
 *
 * Left-aligned on purpose. Six centred headings stacked down one column is
 * the shape every generated marketing page has; a reader's eye has nowhere to
 * rest and each section looks like the last. `SectionTitle` (centred) stays
 * for the sub-pages, where a section is a single idea under a centred header.
 */
export function SectionHead({
	eyebrow,
	title,
	lead,
	action,
	className,
}: {
	eyebrow: string;
	title: string;
	lead?: ReactNode;
	/** A pill or a link, right-aligned from lg up. */
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12",
				className,
			)}
		>
			<div className="max-w-[44rem]">
				<Eyebrow>{eyebrow}</Eyebrow>
				<h2 className="mt-4 text-title text-balance text-foreground sm:text-headline">{title}</h2>
				{lead ? <p className="mt-4 text-lead text-balance text-muted">{lead}</p> : null}
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	);
}

/** A rounded icon tile: the unit every illustration is drawn with. */
export function Tile({
	children,
	size = 56,
	className,
	style,
}: {
	children: ReactNode;
	/** Side in px; the radius scales with it. */
	size?: number;
	className?: string;
	style?: React.CSSProperties;
}) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center justify-center bg-surface-2 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
				className,
			)}
			style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), ...style }}
		>
			{children}
		</span>
	);
}

/*
 * Brand marks whose own colour is within a few percent of black (measured
 * from the simple-icons SVG fill) and would vanish on this page. They are
 * asked for in the foreground colour; every other mark keeps its own.
 */
const DARK_MARKS = new Set([
	"ghost",
	"vaultwarden",
	"ollama",
	"caldotcom",
	"directus",
	"umami",
	"outline",
	"appsmith",
	"coder",
	"github",
	"mariadb",
	"mysql",
	"nextdotjs",
	"vercel",
]);

/** simple-icons slug in the project's own colour, or an absolute URL the catalog already carries. */
export function brandIconSrc(logo: string) {
	if (logo.startsWith("http")) return logo;
	return DARK_MARKS.has(logo)
		? `https://cdn.simpleicons.org/${logo}/f4f4f5`
		: `https://cdn.simpleicons.org/${logo}`;
}

/*
 * A sub-page header: the mark or an icon, a mono eyebrow, the title, one
 * paragraph and the actions, centred like the reference's product pages.
 * Reading pages (docs, about) pass `align="left"` and `size="headline"`.
 */
export function PageHeader({
	eyebrow,
	title,
	description,
	align = "center",
	size = "display",
	icon,
	actions,
	className,
}: {
	eyebrow?: string;
	title: string;
	description?: ReactNode;
	align?: "center" | "left";
	size?: "display" | "headline";
	/** Rendered above the eyebrow, inside a tile. */
	icon?: ReactNode;
	actions?: ReactNode;
	className?: string;
}) {
	const centred = align === "center";
	return (
		<header
			className={cn(
				"flex flex-col pt-16 lg:pt-24",
				centred ? "items-center text-center" : "items-start text-left",
				className,
			)}
		>
			{icon ? (
				<Tile size={56} className="mb-6 bg-surface ring-1 ring-border">
					{icon}
				</Tile>
			) : null}
			{eyebrow ? <Eyebrow className="mb-4">{eyebrow}</Eyebrow> : null}
			<h1
				className={cn(
					"max-w-[20ch] text-balance text-foreground",
					size === "display" ? "text-headline lg:text-display" : "text-title sm:text-headline",
				)}
			>
				{title}
			</h1>
			{description ? (
				<p className="mt-5 max-w-[42rem] text-lead text-balance text-muted">{description}</p>
			) : null}
			{actions ? <div className="mt-8 flex flex-wrap items-center gap-2">{actions}</div> : null}
		</header>
	);
}

/** The small card: a hairline, 16px corners, the page colour (or one surface up on a card). */
export function Panel({
	children,
	className,
	href,
	external,
	tone = "page",
}: {
	children: ReactNode;
	className?: string;
	href?: string;
	external?: boolean;
	tone?: "page" | "surface";
}) {
	const classes = cn(
		"rounded-2xl border border-border p-6",
		tone === "page" ? "bg-background" : "bg-surface-2",
		href && "block transition-colors duration-200 hover:border-border-strong hover:bg-surface",
		className,
	);
	if (href && external) {
		return (
			<a href={href} target="_blank" rel="noreferrer" className={classes}>
				{children}
			</a>
		);
	}
	if (href) {
		return (
			<Link href={href} className={classes}>
				{children}
			</Link>
		);
	}
	return <div className={classes}>{children}</div>;
}

/*
 * The one terminal chrome on the site: a 44px title bar with three muted
 * dots, the title centred, a slot on the right (a tag, a copy button), and
 * the body on the page colour so the frame reads as a screen, never as a
 * card on a card. Everything that types, logs or shows code sits in it.
 */
export function TerminalFrame({
	title,
	tag,
	children,
	className,
	bodyClassName,
}: {
	title?: ReactNode;
	/** Right-hand slot of the bar: a mono word or a control. */
	tag?: ReactNode;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-2xl border border-border bg-background shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]",
				className,
			)}
		>
			<div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface pr-2 pl-4">
				<span className="flex w-[42px] shrink-0 gap-1.5" aria-hidden>
					<span className="size-2.5 rounded-full bg-border-strong" />
					<span className="size-2.5 rounded-full bg-border-strong" />
					<span className="size-2.5 rounded-full bg-border-strong" />
				</span>
				<span className="min-w-0 flex-1 truncate text-center font-mono text-micro text-muted-2">
					{title}
				</span>
				<span className="flex min-w-[42px] shrink-0 items-center justify-end font-mono text-micro text-muted-2">
					{tag}
				</span>
			</div>
			<div className={cn("px-5 py-4 text-small leading-7 text-foreground", bodyClassName)}>
				{children}
			</div>
		</div>
	);
}

/** A command or a config in the terminal chrome, with a copy control in the bar. */
export function CodeBlock({
	code,
	title = "sh",
	className,
}: {
	code: string;
	title?: string;
	className?: string;
}) {
	return (
		<TerminalFrame
			title={title}
			tag={<CopyButton text={code} className="-mr-1" />}
			className={className}
		>
			{/* Long one-liners wrap rather than scroll: on a phone a scrolled command is a hidden command. */}
			<pre className="whitespace-pre-wrap break-all font-mono">
				<code>{code}</code>
			</pre>
		</TerminalFrame>
	);
}

/*
 * The reference's row of section tabs under a product header: rounded chips
 * with an icon, one surface up, the current one a step brighter. Used for
 * jump links and category filters.
 */
export function ChipRow({
	items,
	current,
	className,
	label,
}: {
	items: readonly { href: string; label: string; icon?: LucideIcon }[];
	current?: string;
	className?: string;
	/** aria-label of the nav. */
	label: string;
}) {
	return (
		<nav aria-label={label} className={cn("flex flex-wrap justify-center gap-2", className)}>
			{items.map((item) => {
				const Icon = item.icon;
				const active = item.href === current;
				return (
					<Link
						key={item.href}
						href={item.href}
						aria-current={active ? "page" : undefined}
						className={cn(
							"inline-flex h-11 items-center gap-2 rounded-full px-5 text-body font-medium transition-colors",
							active
								? "bg-surface-3 text-foreground"
								: "bg-surface text-foreground hover:bg-surface-2",
						)}
					>
						{Icon ? <Icon className="size-4 text-muted" aria-hidden /> : null}
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}

/*
 * Reading typography for hand-written pages (about, privacy, compare notes):
 * the children are plain elements and this wrapper gives them the ladder.
 */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div
			className={cn(
				"text-body text-muted [&_a]:text-accent-strong [&_a:hover]:text-foreground [&_code]:rounded-md [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:text-foreground [&_h2]:mt-12 [&_h2]:text-subtitle [&_h2]:text-foreground [&_h2:first-child]:mt-0 [&_h3]:mt-8 [&_h3]:text-body [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:mt-2 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-4 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:marker:text-muted-2",
				className,
			)}
		>
			{children}
		</div>
	);
}
