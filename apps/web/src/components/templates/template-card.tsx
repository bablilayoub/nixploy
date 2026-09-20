"use client";

import { ShieldAlert, Sliders, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { needsInstanceAdmin } from "./template-catalog";
import { TemplateLogo } from "./template-logo";
import type { TemplateSummary } from "./templates-view";

/**
 * One gallery entry.
 *
 * The whole card is the "open details" target — a stretched transparent button
 * rather than a wrapper `<button>`, so the Deploy button can sit inside it
 * without nesting one interactive element in another. Deploy is raised above
 * that overlay with `z-10`; everything else is inert text.
 *
 * What the card prints is what you need *before* committing: the catalog it
 * came from, how many values the deploy form will ask for, whether it needs
 * the instance admin, and two tags to tell two similar entries apart. The
 * rest is a click away in the details sheet.
 */
export function TemplateCard({
	template,
	onInspect,
	onDeploy,
	deployBlocker,
	onTag,
}: {
	template: TemplateSummary;
	onInspect: () => void;
	onDeploy: () => void;
	/** Reason the caller cannot deploy (disables the button), or null. */
	deployBlocker: string | null;
	/** Clicking a tag filters by it. */
	onTag?: (tag: string) => void;
}) {
	const settingsCount = template.env.length;
	const admin = needsInstanceAdmin(template);
	return (
		<article className="group relative flex h-full flex-col rounded-xl border bg-card p-4 transition-all hover:-translate-y-px hover:border-foreground/20 hover:shadow-sm">
			<div className="flex items-start gap-2.5">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-inset ring-border/60">
					<TemplateLogo name={template.name} logo={template.logo} />
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<h3 className="truncate text-sm font-medium">{template.name}</h3>
					{/* Category and catalog on one muted line rather than a badge in the
					    corner: the badge took a quarter of the header and truncated the
					    name to "AI te…" on a four-column grid. The built-ins carry no
					    source, so most cards print the category alone. */}
					<span className="truncate text-[11px] text-muted-foreground/80">
						{template.category}
						{template.source ? ` · ${template.source.name}` : ""}
					</span>
				</div>
				{/* The admin flag rides here rather than in the footer: down there it
				    shared a row with the deploy button and wrapped the setting count
				    onto a second line on any card that carried both. */}
				{admin ? (
					<ShieldAlert
						className="size-3.5 shrink-0 text-warning"
						aria-label="Needs the instance admin: host access or published ports"
					/>
				) : null}
			</div>

			{/* Two lines, always — reserving the height keeps every row of the grid
			    on the same baseline whether a description is 6 words or 30. */}
			<p className="mt-3 line-clamp-2 min-h-9 text-xs leading-[1.125rem] text-muted-foreground">
				{template.description}
			</p>

			{/* Tags are clickable filters, raised above the card overlay. Two of
			    them: a third pushed the row onto a second line at `sm`. */}
			<div className="mt-3 flex min-h-5 flex-wrap items-center gap-1">
				{template.tags.slice(0, 2).map((tag) => (
					<button
						key={tag}
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onTag?.(tag);
						}}
						className={cn(
							"relative z-10 rounded border px-1.5 py-px text-[10px] text-muted-foreground transition-colors",
							onTag ? "hover:border-foreground/30 hover:text-foreground" : "cursor-default",
						)}
					>
						{tag}
					</button>
				))}
			</div>

			<div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
				<span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground/80">
					{settingsCount === 0 ? (
						<>
							<Zap className="size-3" aria-hidden />
							No setup needed
						</>
					) : (
						<>
							<Sliders className="size-3" aria-hidden />
							{settingsCount} {settingsCount === 1 ? "setting" : "settings"}
						</>
					)}
				</span>
				{/* Quiet until the card is engaged, then it reads as the primary action.
				    The stacked `group-hover:hover:` is not redundant: the button's own
				    `hover:bg-secondary/80` would otherwise fight `group-hover:bg-primary`
				    at the moment the pointer is actually on the button. */}
				<Button
					size="sm"
					variant="secondary"
					className="relative z-10 group-hover:bg-primary group-hover:text-primary-foreground group-hover:hover:bg-primary/90"
					onClick={onDeploy}
					disabled={deployBlocker !== null}
					title={deployBlocker ?? undefined}
				>
					Deploy
				</Button>
			</div>

			<button
				type="button"
				onClick={onInspect}
				className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span className="sr-only">{template.name} details</span>
			</button>
		</article>
	);
}
