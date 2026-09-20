"use client";

import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { needsInstanceAdmin } from "./template-catalog";
import { TemplateLogo } from "./template-logo";
import type { TemplateSummary } from "./templates-view";

/**
 * The gallery as a table: the same rows, the same filters, one line each.
 *
 * It exists because the grid answers "what is there" and this answers "which
 * one" — scanning forty entries for the one with no settings, or comparing
 * what two catalogs both ship, is a column job. The row is the details target
 * and Deploy stays an explicit button, exactly as on a card.
 */
export function TemplatesTable({
	templates,
	onInspect,
	onDeploy,
	deployBlocker,
}: {
	templates: TemplateSummary[];
	onInspect: (template: TemplateSummary) => void;
	onDeploy: (template: TemplateSummary) => void;
	deployBlocker: (template: TemplateSummary) => string | null;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Template</TableHead>
					<TableHead className="hidden md:table-cell">Category</TableHead>
					<TableHead className="hidden lg:table-cell">Catalog</TableHead>
					<TableHead className="hidden sm:table-cell">Setup</TableHead>
					<TableHead className="text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{templates.map((template) => {
					const blocker = deployBlocker(template);
					const settings = template.env.length;
					return (
						<TableRow
							key={template.id}
							className="cursor-pointer"
							onClick={() => onInspect(template)}
						>
							<TableCell className="max-w-96">
								<div className="flex items-center gap-2.5">
									<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-inset ring-border/60">
										<TemplateLogo name={template.name} logo={template.logo} />
									</div>
									<div className="flex min-w-0 flex-col">
										<span className="flex items-center gap-1.5 font-medium">
											{template.name}
											{needsInstanceAdmin(template) ? (
												<ShieldAlert
													className="size-3.5 text-warning"
													aria-label="Needs the instance admin"
												/>
											) : null}
										</span>
										<span className="truncate text-xs text-muted-foreground">
											{template.description}
										</span>
									</div>
								</div>
							</TableCell>
							<TableCell className="hidden text-muted-foreground md:table-cell">
								{template.category}
							</TableCell>
							<TableCell className="hidden lg:table-cell">
								{template.source ? (
									<Badge variant="secondary" className="max-w-32 truncate font-normal">
										{template.source.name}
									</Badge>
								) : (
									<span className="text-muted-foreground">Built-in</span>
								)}
							</TableCell>
							<TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">
								{settings === 0 ? "None" : `${settings} ${settings === 1 ? "value" : "values"}`}
							</TableCell>
							<TableCell className="text-right">
								<Button
									size="sm"
									variant="outline"
									disabled={blocker !== null}
									title={blocker ?? undefined}
									onClick={(event) => {
										event.stopPropagation();
										onDeploy(template);
									}}
								>
									Deploy
								</Button>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
