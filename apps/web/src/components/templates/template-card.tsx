"use client";

import { BookOpen, Code2, Globe, ShieldAlert, Sliders, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { needsInstanceAdmin } from "./template-catalog";
import { TemplateLogo } from "./template-logo";
import type { TemplateSummary } from "./templates-view";

/**
 * One gallery entry.
 *
 * Three bands rather than one padded block: a header (mark, name, where it
 * came from), a recessed body holding the description and tags, and a footer
 * with what it will ask for and what to do about it. The recess is what makes
 * the card read as a card on a near-black canvas — `--card` sits four points
 * above `--background` in dark mode, which is not enough contrast to carry a
 * whole surface on its own.
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
		<article className="group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-all hover:-translate-y-px hover:border-foreground/20 hover:shadow-md">
			<div className="flex items-start gap-3 p-4">
				{/* A tile one step LIGHTER than the card, not darker: a well cut into
				    a near-black card reads as a hole, and the brand marks — most of
				    them dark-ish SVGs — lose their edges in it. */}
				<div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted ring-1 ring-inset ring-border">
					<TemplateLogo name={template.name} logo={template.logo} className="size-6" />
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<h3 className="truncate text-sm font-semibold">{template.name}</h3>
					<span className="truncate text-[11px] text-muted-foreground">
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

			<div className="flex flex-1 flex-col gap-2.5 border-y bg-muted/60 px-4 py-3">
				{/* Two lines, always — reserving the height keeps every row of the grid
				    on the same baseline whether a description is 6 words or 30. */}
				<p className="line-clamp-2 min-h-9 text-xs leading-[1.125rem] text-muted-foreground">
					{template.description}
				</p>
				{/* Tags are clickable filters. Two of them: a third pushed the row onto
				    a second line at `sm`. */}
				<div className="flex min-h-5 flex-wrap items-center gap-1">
					{template.tags.slice(0, 2).map((tag) => (
						<button
							key={tag}
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onTag?.(tag);
							}}
							className={cn(
								"relative z-10 rounded-md border bg-background/60 px-1.5 py-px text-[10px] text-muted-foreground transition-colors",
								onTag ? "hover:border-foreground/30 hover:text-foreground" : "cursor-default",
							)}
						>
							{tag}
						</button>
					))}
				</div>
			</div>

			<div className="flex items-center justify-between gap-2 px-4 py-3">
				<span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground">
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
				<div className="flex shrink-0 items-center gap-0.5">
					{/* Where the project lives, for the decision made before deploying.
					    Quiet rather than hidden: a hover-only control does not exist on a
					    touch screen, and three dim glyphs cost the row nothing. */}
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
					{/* Quiet until the card is engaged, then it reads as the primary
					    action. The stacked `group-hover:hover:` is not redundant: the
					    button's own `hover:bg-secondary/80` would otherwise fight
					    `group-hover:bg-primary` at the moment the pointer is on it. */}
					<Button
						size="sm"
						variant="secondary"
						className="relative z-10 ms-1 group-hover:bg-primary group-hover:text-primary-foreground group-hover:hover:bg-primary/90"
						onClick={onDeploy}
						disabled={deployBlocker !== null}
						title={deployBlocker ?? undefined}
					>
						Deploy
					</Button>
				</div>
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
