import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Settings panel — bordered cover around title/actions/body.
 * Full-width. No fill color (border only).
 * Pass `bare` when the body already has its own frame (tables, viewers).
 */
export function SettingsSection({
	title,
	description,
	children,
	danger = false,
	wide: _wide = false,
	bare = false,
	className,
	actions,
	id,
}: {
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	danger?: boolean;
	/**
	 * @deprecated Body is always full width. Kept so call sites keep compiling.
	 */
	wide?: boolean;
	/** Skip outer border/padding — header + body only. */
	bare?: boolean;
	className?: string;
	actions?: ReactNode;
	/** In-page jump target (e.g. Platform section anchors). */
	id?: string;
}) {
	void _wide;

	if (danger) {
		return (
			<section
				id={id}
				className={cn("scroll-mt-24 rounded-lg border border-destructive/40 p-4 sm:p-5", className)}
			>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
					<div className="min-w-0 space-y-1">
						<h3 className="text-sm font-medium text-destructive">{title}</h3>
						{description ? (
							<p className="text-sm text-muted-foreground text-pretty">{description}</p>
						) : null}
					</div>
					{actions ? (
						<div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
					) : null}
				</div>
				{children ? <div className="mt-4 w-full">{children}</div> : null}
			</section>
		);
	}

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
				<div className="min-w-0 max-w-2xl space-y-1">
					<h3 className="text-sm font-medium text-foreground">{title}</h3>
					{description ? (
						<p className="text-sm text-muted-foreground text-pretty">{description}</p>
					) : null}
				</div>
				{actions ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
				) : null}
			</div>
			{children ? <div className={cn("w-full space-y-4", bare ? "mt-4" : "mt-5")}>{children}</div> : null}
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
