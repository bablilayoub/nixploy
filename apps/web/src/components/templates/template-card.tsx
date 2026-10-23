"use client";
import { BookOpen, Code2, Globe, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { needsInstanceAdmin } from "./template-catalog";
import { TemplateLogo } from "./template-logo";
import type { TemplateSummary } from "./templates-view";

/** A catalogue object: identity, requirements, description, then an explicit action. */
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
	deployBlocker: string | null;
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
		<article className="group relative flex h-full min-w-0 flex-col rounded-xl border bg-card transition-colors hover:border-input">
			<header className="flex items-start gap-3 px-5 pt-5">
				<span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-panel-inset">
					<TemplateLogo name={template.name} logo={template.logo} className="size-7" />
				</span>
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-base leading-snug font-medium tracking-tight">
						<Button
							variant="ghost"
							size="sm"
							type="button"
							onClick={onInspect}
							aria-label={`${template.name} details`}
							className="fieldwork-template-title h-auto min-h-0 px-0 py-0 text-base font-medium inline-flex max-w-full items-center text-start underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						>
							<span className="truncate">{template.name}</span>
						</Button>
					</h3>
					<p className="mt-1 text-xs text-muted-foreground">{template.category}</p>
				</div>
				{admin && (
					<ShieldAlert
						className="mt-1 size-4 shrink-0 text-warning"
						aria-label="Needs the instance admin: host access or published ports"
					/>
				)}
			</header>
			<p className="mt-4 line-clamp-2 min-h-10 px-5 text-sm leading-5 text-muted-foreground">
				{template.description}
			</p>
			<div className="mt-4 flex min-h-7 flex-wrap items-center gap-1.5 px-5">
				{template.tags.slice(0, 3).map((tag) =>
					onTag ? (
						<Button
							variant="ghost"
							size="sm"
							type="button"
							key={tag}
							onClick={(event) => {
								event.stopPropagation();
								onTag(tag);
							}}
							className="fieldwork-template-tag h-auto min-h-7 relative z-10 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground hover:border-input hover:text-foreground"
						>
							{tag}
						</Button>
					) : (
						<span
							key={tag}
							className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground"
						>
							{tag}
						</span>
					),
				)}
			</div>
			<div className="mt-auto px-5 pt-4 pb-4">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<span>
						{settingsCount === 0
							? "No configuration needed"
							: `${settingsCount} ${settingsCount === 1 ? "setting" : "settings"}`}
					</span>
					{template.source && <span className="truncate">{template.source.name}</span>}
				</div>
			</div>
			<footer className="flex items-center justify-between gap-2 rounded-b-xl px-4 pb-4 pt-1">
				<div className="flex items-center gap-1">
					{links.map((link) => (
						<a
							key={link.label}
							href={link.href}
							target="_blank"
							rel="noreferrer"
							aria-label={`${template.name}: ${link.label}`}
							onClick={(event) => event.stopPropagation()}
							className="fieldwork-template-link relative z-10 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							<link.icon aria-hidden="true" className="size-3.5" />
						</a>
					))}
				</div>
				<Button
					size="sm"
					variant="outline"
					className="relative z-10 bg-card"
					onClick={onDeploy}
					disabled={deployBlocker !== null}
					title={deployBlocker ?? undefined}
				>
					Deploy
				</Button>
			</footer>
		</article>
	);
}
