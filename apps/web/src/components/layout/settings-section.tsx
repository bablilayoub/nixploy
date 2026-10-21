import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A form section uses alignment and space; tables/editors keep their own frame. */
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
	bare?: boolean;
	wide?: boolean;
	className?: string;
	actions?: ReactNode;
	id?: string;
}) {
	const stacked = wide || bare || danger;
	return (
		<section
			id={id}
			className={cn(
				"fieldwork-settings-section",
				danger && "fieldwork-settings-danger",
				!stacked && "fieldwork-settings-split",
				className,
			)}
		>
			<div
				className={cn(
					"min-w-0",
					stacked && "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
				)}
			>
				<div className="max-w-xl space-y-2">
					<h3
						className={cn(
							"text-base leading-snug font-medium tracking-tight",
							danger ? "text-destructive" : "text-foreground",
						)}
					>
						{title}
					</h3>
					{description && (
						<p className="max-w-lg text-sm leading-relaxed text-muted-foreground">{description}</p>
					)}
				</div>
				{stacked && actions && (
					<div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
				)}
			</div>
			{(children || (!stacked && actions)) && (
				<div className={cn("fieldwork-settings-body", stacked && "mt-5")}>
					{!stacked && actions && (
						<div className="mb-4 flex flex-wrap items-center gap-2">{actions}</div>
					)}
					{children && <div className="min-w-0 space-y-4">{children}</div>}
				</div>
			)}
		</section>
	);
}
export function SettingsStack({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("flex w-full min-w-0 flex-col gap-0", className)}>{children}</div>;
}
