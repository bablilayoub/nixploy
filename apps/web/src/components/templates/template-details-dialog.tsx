"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Box, ExternalLink, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";
import { TemplateLogo } from "./template-logo";
import type { TemplateSummary } from "./templates-view";

type TemplateDetails = inferRouterOutputs<AppRouter>["template"]["one"];

function LinkChip({ href, label }: { href: string; label: string }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
		>
			{label}
			<ExternalLink className="size-3" />
		</a>
	);
}

function ServiceCard({ service }: { service: TemplateDetails["services"][number] }) {
	return (
		<div className="flex flex-col gap-2 rounded-md border p-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Box className="size-3.5 text-muted-foreground" />
					<span className="font-mono text-sm font-medium">{service.name}</span>
				</div>
				{service.isDomainTarget && (
					<Badge variant="secondary" className="text-xs">
						domain target
					</Badge>
				)}
			</div>
			{service.image ? (
				<p className="truncate font-mono text-xs text-muted-foreground">{service.image}</p>
			) : (
				<p className="text-xs text-muted-foreground">No image (build context)</p>
			)}
			{service.dependsOn.length > 0 && (
				<p className="text-xs text-muted-foreground">
					Depends on{" "}
					{service.dependsOn.map((dep) => (
						<Badge key={dep} variant="outline" className="mr-1 font-mono text-xs">
							{dep}
						</Badge>
					))}
				</p>
			)}
			{service.volumes.length > 0 && (
				<div className="flex flex-col gap-1">
					<span className="text-xs font-medium text-muted-foreground">Volumes</span>
					<ul className="space-y-0.5">
						{service.volumes.map((volume) => (
							<li key={volume} className="truncate font-mono text-xs text-muted-foreground">
								{volume}
							</li>
						))}
					</ul>
				</div>
			)}
			{service.envKeys.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{service.envKeys.map((key) => (
						<Badge key={key} variant="outline" className="font-mono text-xs">
							{key}
						</Badge>
					))}
				</div>
			)}
		</div>
	);
}

function DetailsBody({ template, onDeploy }: { template: TemplateDetails; onDeploy: () => void }) {
	const links = [
		template.links.website ? { href: template.links.website, label: "Website" } : null,
		template.links.docs ? { href: template.links.docs, label: "Docs" } : null,
		template.links.github ? { href: template.links.github, label: "GitHub" } : null,
	].filter(Boolean) as { href: string; label: string }[];

	return (
		<>
			<div className="flex items-start gap-3">
				<TemplateLogo name={template.name} logo={template.logo} className="size-10" />
				<div className="flex min-w-0 flex-col gap-1">
					<p className="text-sm text-muted-foreground">{template.description}</p>
					<div className="flex flex-wrap gap-1.5 pt-1">
						<Badge variant="secondary">{template.category}</Badge>
						{template.tags.map((tag) => (
							<Badge key={tag} variant="outline">
								{tag}
							</Badge>
						))}
					</div>
					{links.length > 0 && (
						<div className="flex flex-wrap gap-2 pt-2">
							{links.map((link) => (
								<LinkChip key={link.label} href={link.href} label={link.label} />
							))}
						</div>
					)}
				</div>
			</div>

			<Separator />

			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-medium">
						Services{" "}
						<span className="font-normal text-muted-foreground">({template.services.length})</span>
					</h3>
					<p className="text-xs text-muted-foreground">
						Domain →{" "}
						<span className="font-mono">
							{template.suggestedDomain.serviceName}:{template.suggestedDomain.port}
						</span>
					</p>
				</div>
				<div className="grid gap-2 sm:grid-cols-2">
					{template.services.map((service) => (
						<ServiceCard key={service.name} service={service} />
					))}
				</div>
			</div>

			{template.env.length > 0 && (
				<>
					<Separator />
					<div className="flex flex-col gap-2">
						<h3 className="text-sm font-medium">
							Environment variables{" "}
							<span className="font-normal text-muted-foreground">({template.env.length})</span>
						</h3>
						<div className="overflow-hidden rounded-md border">
							<table className="w-full text-left text-sm">
								<thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
									<tr>
										<th className="px-3 py-2 font-medium">Key</th>
										<th className="px-3 py-2 font-medium">Default</th>
										<th className="px-3 py-2 font-medium">Description</th>
									</tr>
								</thead>
								<tbody>
									{template.env.map((entry) => (
										<tr key={entry.key} className="border-b last:border-0">
											<td className="px-3 py-2 align-top font-mono text-xs">{entry.key}</td>
											<td className="px-3 py-2 align-top font-mono text-xs text-muted-foreground">
												{entry.default.includes("{{generateSecret}}")
													? "auto-generated"
													: entry.default || "—"}
											</td>
											<td className="px-3 py-2 align-top text-xs text-muted-foreground">
												{entry.description}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</>
			)}

			<details className="rounded-md border">
				<summary className="cursor-pointer px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
					View compose file
				</summary>
				<pre className="max-h-64 overflow-auto border-t bg-secondary/30 p-3 font-mono text-xs leading-relaxed">
					{template.compose}
				</pre>
			</details>

			<DialogFooter>
				<Button onClick={onDeploy}>Deploy</Button>
			</DialogFooter>
		</>
	);
}

export function TemplateDetailsDialog({
	template,
	onClose,
	onDeploy,
}: {
	template: TemplateSummary | null;
	onClose: () => void;
	onDeploy: (template: TemplateSummary) => void;
}) {
	const trpc = useTRPC();
	const detailsQuery = useQuery({
		...trpc.template.one.queryOptions({ templateId: template?.id ?? "" }),
		enabled: template !== null,
	});

	return (
		<Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{template?.name ?? "Template"}</DialogTitle>
					<DialogDescription>
						What this template deploys — services, env vars and links.
					</DialogDescription>
				</DialogHeader>

				{detailsQuery.isPending && (
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							Loading details…
						</div>
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-32 w-full" />
					</div>
				)}

				{detailsQuery.isError && (
					<p className="text-sm text-destructive">{detailsQuery.error.message}</p>
				)}

				{detailsQuery.data && template && (
					<DetailsBody
						template={detailsQuery.data}
						onDeploy={() => {
							onClose();
							onDeploy(template);
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
