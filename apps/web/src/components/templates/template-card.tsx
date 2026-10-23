"use client";

import { BookOpen, Code2, Eye, Globe, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { needsInstanceAdmin } from "./template-catalog";
import { TemplateLogo } from "./template-logo";
import type { TemplateSummary } from "./templates-view";

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
	const admin = needsInstanceAdmin(template);
	const settingsCount = template.env.length;
	const links = [
		{ href: template.links.github, label: "Source", icon: Code2 },
		{ href: template.links.website, label: "Website", icon: Globe },
		{ href: template.links.docs, label: "Documentation", icon: BookOpen },
	].filter((link): link is { href: string; label: string; icon: typeof Globe } =>
		Boolean(link.href),
	);
	return (
		<Card className="h-full min-w-0">
			<CardHeader>
				<div className="mb-3">
					<TemplateLogo name={template.name} logo={template.logo} className="size-9" />
				</div>
				<CardTitle as="h3">
					<Button
						variant="link"
						className="h-auto justify-start p-0 text-base"
						onClick={onInspect}
						aria-label={`${template.name} details`}
					>
						{template.name}
					</Button>
				</CardTitle>
				<CardDescription>{template.category}</CardDescription>
				<CardAction>
					<Button
						size="icon-sm"
						variant="ghost"
						onClick={onInspect}
						aria-label={`Preview ${template.name}`}
					>
						<Eye aria-hidden="true" />
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-1 flex-col gap-4">
				<CardDescription>{template.description}</CardDescription>
				<div className="flex flex-wrap gap-2">
					{template.tags.slice(0, 3).map((tag) =>
						onTag ? (
							<Button key={tag} size="sm" variant="secondary" onClick={() => onTag(tag)}>
								{tag}
							</Button>
						) : (
							<Badge key={tag} variant="secondary">
								{tag}
							</Badge>
						),
					)}
				</div>
				<div className="mt-auto flex flex-wrap gap-2 text-xs text-muted-foreground">
					<span>
						{settingsCount === 0
							? "No configuration needed"
							: `${settingsCount} ${settingsCount === 1 ? "setting" : "settings"}`}
					</span>
					{template.source && <span>· {template.source.name}</span>}
					{admin && (
						<span className="flex items-center gap-1">
							<ShieldAlert aria-hidden="true" className="size-3.5" />
							Instance admin required
						</span>
					)}
				</div>
			</CardContent>
			<CardFooter className="justify-between gap-2 border-t">
				<div className="flex flex-wrap gap-1">
					{links.map((link) => (
						<Button key={link.label} asChild variant="ghost" size="icon-sm">
							<a
								href={link.href}
								target="_blank"
								rel="noreferrer"
								aria-label={`${template.name}: ${link.label}`}
							>
								<link.icon aria-hidden="true" />
							</a>
						</Button>
					))}
				</div>
				<Button
					size="sm"
					onClick={onDeploy}
					disabled={deployBlocker !== null}
					title={deployBlocker ?? undefined}
				>
					Deploy
				</Button>
			</CardFooter>
		</Card>
	);
}
