"use client";

import { BookOpen, Code2, Globe, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { needsInstanceAdmin } from "./template-catalog";
import { TemplateLogo } from "./template-logo";
import type { TemplateSummary } from "./templates-view";

/**
 * One gallery entry.
 *
 * No fill: a border on the page's own black, the way the dashboard's cards are
 * drawn. Every surface inside it is quiet for the same reason — the marks and
 * the deploy button are the only things meant to carry colour.
 *
 * The mark leads. A catalog is scanned by logo — nobody reads four hundred
 * names — so it gets its own row at 56px, centred, with the name and what the
 * entry asks for under it, and the description in a recessed block below. That
 * recess is doing real work: `--card` sits four points above `--background` in
 * dark mode, and one flat panel at that contrast reads as a grey rectangle
 * rather than a card.
 *
 * The whole card is the "open details" target — a stretched transparent button
 * rather than a wrapper `<button>`, so the deploy button and the links can sit
 * inside it without nesting one interactive element in another. Those are
 * raised above the overlay with `z-10`; everything else is inert text.
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
	const links = [
		{ href: template.links.github, label: "Source", icon: Code2 },
		{ href: template.links.website, label: "Website", icon: Globe },
		{ href: template.links.docs, label: "Documentation", icon: BookOpen },
	].filter((link): link is { href: string; label: string; icon: typeof Globe } =>
		Boolean(link.href),
	);

	return (
		<article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border transition-colors hover:border-foreground/25">
			{/* The corner carries provenance: which catalog, and whether it needs the
			    instance admin. Absolute so it never pushes the mark off centre. */}
			<div className="absolute end-3 top-3 z-[1] flex items-center gap-1">
				{admin ? (
					<ShieldAlert
						className="size-3.5 text-warning"
						aria-label="Needs the instance admin: host access or published ports"
					/>
				) : null}
				{template.source ? (
					<span className="max-w-24 truncate rounded-md border bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{template.source.name}
					</span>
				) : null}
			</div>

			<div className="flex flex-col items-center gap-3 px-4 pt-6 pb-3 text-center">
				{/* One step off the card, nothing more: `template-logo.tsx` already
				    tints the marks that would vanish on a dark tile. */}
				<div className="flex size-12 items-center justify-center rounded-xl bg-muted ring-1 ring-inset ring-border">
					<TemplateLogo name={template.name} logo={template.logo} className="size-7" />
				</div>
				<div className="flex w-full min-w-0 flex-col gap-0.5">
					<h3 className="truncate text-[15px] leading-tight font-semibold">{template.name}</h3>
					<p className="truncate text-[11px] text-muted-foreground">
						{template.category} ·{" "}
						{settingsCount === 0
							? "no setup"
							: `${settingsCount} ${settingsCount === 1 ? "setting" : "settings"}`}
					</p>
				</div>
				{/* Tags are clickable filters. Three fit on one row at every column
				    count the grid uses; a fourth wrapped and broke the baseline. */}
				<div className="flex min-h-[1.375rem] flex-wrap items-center justify-center gap-1">
					{template.tags.slice(0, 3).map((tag) => (
						<button
							key={tag}
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onTag?.(tag);
							}}
							className={cn(
								"relative z-10 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors",
								onTag ? "hover:border-foreground/30 hover:text-foreground" : "cursor-default",
							)}
						>
							{tag}
						</button>
					))}
				</div>
			</div>

			{/* Two lines reserved — the reservation is what keeps a row of cards on
			    one baseline; the card is otherwise one flat surface, like every
			    other card in the dashboard. */}
			<p className="line-clamp-2 min-h-9 flex-1 px-4 text-center text-xs leading-[1.125rem] text-muted-foreground">
				{template.description}
			</p>

			<div className="mt-4 flex items-center justify-between gap-2 border-t px-3 py-2.5">
				<div className="flex min-w-0 items-center gap-0.5">
					{/* Where the project lives, for the decision made before deploying.
					    Quiet rather than hover-revealed: a hover-only control does not
					    exist on a touch screen. */}
					{links.map((link) => (
						<a
							key={link.label}
							href={link.href}
							target="_blank"
							rel="noreferrer"
							aria-label={`${template.name}: ${link.label}`}
							onClick={(event) => event.stopPropagation()}
							className="relative z-10 inline-flex rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						>
							<link.icon className="size-3.5" />
						</a>
					))}
				</div>
				{/* Quiet until the card is engaged, then it reads as the primary
				    action. The stacked `group-hover:hover:` is not redundant: the
				    button's own `hover:bg-secondary/80` would otherwise fight
				    `group-hover:bg-primary` at the moment the pointer is on it. */}
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
