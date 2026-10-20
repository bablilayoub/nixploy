import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Settings panel — bordered cover around title/actions/body.
 *
 * From `lg` up the heading sits in its own column beside the controls rather
 * than above them. The stacked version left a 1100px-wide card with a 300px
 * input hugging its left edge and half the card empty; splitting it puts the
 * label where a label belongs and lets the body use the width it was given.
 * Below `lg` it stacks exactly as before, because at phone and tablet widths
 * there is no second column to give away.
 *
 * Pass `bare` when the body already has its own frame (tables, viewers) and
 * `wide` when the body needs the full width — a log viewer, a terminal, a
 * chart, a wide table. `bare` implies `wide`.
 */
export function SettingsSection({
	title,
	description,
	children,
	danger = false,
	bare = false,
	wide = false,
	className,
	actions,
	id,
}: {
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	danger?: boolean;
	/** Skip outer border/padding — header + body only. Implies `wide`. */
	bare?: boolean;
	/** Keep the heading above the body instead of beside it. */
	wide?: boolean;
	className?: string;
	actions?: ReactNode;
	/** In-page jump target (e.g. Platform section anchors). */
	id?: string;
}) {
	const heading = (
		<div className="min-w-0 space-y-1">
			<h3 className={cn("text-sm font-medium", danger ? "text-destructive" : "text-foreground")}>
				{title}
			</h3>
			{description ? (
				<p className="text-sm text-muted-foreground text-pretty">{description}</p>
			) : null}
		</div>
	);

	if (danger) {
		return (
			<section
				id={id}
				className={cn("scroll-mt-24 rounded-lg border border-destructive/40 p-4 sm:p-5", className)}
			>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
					{heading}
					{actions ? (
						<div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
					) : null}
				</div>
				{children ? <div className="mt-4 w-full">{children}</div> : null}
			</section>
		);
	}

	const stacked = wide || bare;

	if (stacked) {
		return (
			<section
				id={id}
				className={cn(
					"w-full scroll-mt-24",
					bare ? "py-1" : "rounded-lg border border-border p-4 sm:p-5",
					className,
				)}
			>
				<div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
					<div className="max-w-2xl">{heading}</div>
					{actions ? (
						<div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
					) : null}
				</div>
				{children ? (
					<div className={cn("w-full space-y-4", bare ? "mt-4" : "mt-5")}>{children}</div>
				) : null}
			</section>
		);
	}

	return (
		<section
			id={id}
			className={cn(
				"w-full scroll-mt-24 rounded-lg border border-border p-4 sm:p-5",
				// The heading column is fixed so headings line up down the page; the
				// body takes whatever is left and never drops below its own minimum.
				"lg:grid lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-8",
				className,
			)}
		>
			{heading}
			<div className={cn("w-full", children || actions ? "mt-5 lg:mt-0" : null)}>
				{actions ? (
					<div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
				) : null}
				{children ? (
					<div className={cn("w-full space-y-4", actions ? "mt-4" : null)}>{children}</div>
				) : null}
			</div>
		</section>
	);
}

/** Stack of SettingsSection panels with spacing between covers. */
export function SettingsStack({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("flex w-full flex-col gap-4", className)}>{children}</div>;
}
