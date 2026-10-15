"use client";

import type { ImportPlan, ImportResult } from "@nixploy/server/modules/import/index";
import { ArrowRight, CheckCircle2, Download, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { importBlockers, migrationTasks } from "./migration-model";

export function MigrationReview({
	plan,
	result,
	pending,
	can,
	onApply,
	onReplan,
}: {
	plan: ImportPlan;
	result: ImportResult | null;
	pending: boolean;
	can: (capability: string) => boolean;
	onApply: () => void;
	onReplan: () => void;
}) {
	const [confirmed, setConfirmed] = useState(false);
	const blockers = importBlockers(plan, can);
	const report = result ?? plan;
	const tasks = migrationTasks(report);
	const download = () => {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = result ? "nixploy-import-results.json" : "nixploy-import-plan.json";
		anchor.click();
		URL.revokeObjectURL(url);
	};
	return (
		<div className="space-y-6" aria-live="polite">
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-2">
							<CardTitle>{result ? "Import results" : "3. Review the import"}</CardTitle>
							<CardDescription className="break-words">
								{plan.source.project} / {plan.source.environment}{" "}
								<ArrowRight className="mx-1 inline size-3.5" aria-label="to" />{" "}
								{plan.target.projectName} / {plan.target.environmentName}
							</CardDescription>
						</div>
						<Button variant="outline" size="sm" onClick={download}>
							<Download className="size-4" />
							Download redacted report
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-5">
					<dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
						{Object.entries(plan.counts).map(([label, value]) => (
							<div key={label} className="rounded-md bg-muted/50 px-3 py-2">
								<dt className="text-xs text-muted-foreground capitalize">{label}</dt>
								<dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
							</div>
						))}
					</dl>
					<p className="text-sm text-muted-foreground">
						{plan.target.createsProject
							? "Creates a project and environment."
							: plan.target.createsEnvironment
								? "Creates an environment in the existing project."
								: "Uses an existing environment; review updates below."}{" "}
						Imported configuration is saved idle. Deployment and proxy updates wait for your
						explicit action.
					</p>
					{plan.plan && (
						<div className="max-h-72 overflow-auto rounded-md border">
							<table className="w-full text-start text-sm">
								<caption className="sr-only">Changes to the target environment</caption>
								<thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
									<tr>
										<th className="px-3 py-2 text-start font-medium">Action</th>
										<th className="px-3 py-2 text-start font-medium">Resource</th>
										<th className="px-3 py-2 text-start font-medium">Changed fields</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{plan.plan.items.map((item) => (
										<tr key={`${item.parentKind}:${item.parent}:${item.kind}:${item.name}`}>
											<td className="px-3 py-2">{item.action}</td>
											<td className="px-3 py-2 break-words">
												{item.kind} / {item.name}
											</td>
											<td className="px-3 py-2 text-muted-foreground">
												{item.changes?.join(", ") || "—"}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					{plan.valueGroups?.length > 0 && (
						<section className="space-y-2">
							<h3 className="text-sm font-medium">Environment values</h3>
							<p className="text-sm text-muted-foreground">
								Copy replaces the listed value group. Clear removes its existing variables.
								Preserved groups stay unchanged. Project and environment values are shared with
								other services in the target; values are hidden here.
							</p>
							<ul className="divide-y rounded-md border">
								{plan.valueGroups.map((group) => (
									<li key={`${group.target}:${group.field}`} className="space-y-1 px-3 py-2.5">
										<div className="flex flex-wrap justify-between gap-2 text-sm">
											<span className="break-words font-medium">
												{group.target} · {group.field}
											</span>
											<span className="text-muted-foreground">
												{group.action === "preserve"
													? "Preserve target values"
													: group.action === "clear"
														? "Clear target values"
														: `Copy ${group.keys.length} keys`}
											</span>
										</div>
										{group.keys.length > 0 && (
											<p className="break-all font-mono text-xs text-muted-foreground">
												{group.keys.join(", ")}
											</p>
										)}
									</li>
								))}
							</ul>
						</section>
					)}

					{plan.notes.length > 0 && (
						<section className="space-y-2">
							<h3 className="text-sm font-medium">Manual work and compatibility notes</h3>
							<ul className="divide-y rounded-md border">
								{plan.notes.map((note) => (
									<li
										key={`${note.service}:${note.message}`}
										className="flex items-start gap-2 px-3 py-3 text-sm"
									>
										<TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
										<div className="min-w-0 break-words">
											{note.service && <span className="font-medium">{note.service}: </span>}
											{note.message}
										</div>
									</li>
								))}
							</ul>
						</section>
					)}
					{result ? (
						<div className="space-y-3 rounded-md border p-4">
							<p className="flex items-center gap-2 font-medium">
								<CheckCircle2 className="size-4" />
								{result.result.applied} resources applied; {result.result.errors.length} failed
							</p>
							{result.result.errors.map((error) => (
								<p
									key={`${error.kind}:${error.name}:${error.message}`}
									className="text-sm text-destructive"
								>
									{error.kind} / {error.name}: {error.message}
								</p>
							))}
							{result.secrets.missing.length > 0 && (
								<p className="text-sm text-warning">
									Values could not be matched to: {result.secrets.missing.join(", ")}. Review these
									services and retry with a fresh plan.
								</p>
							)}
							<p className="text-sm text-muted-foreground">
								{result.secrets.applied.length} environment value sets written. Nothing was
								deployed.
							</p>
							<div className="flex flex-wrap gap-2">
								<Button asChild>
									<Link href={`/dashboard/projects/${result.target.projectId}`}>
										Open target project
										<ArrowRight className="size-4" />
									</Link>
								</Button>
								<Button variant="outline" onClick={onReplan}>
									Review again
								</Button>
							</div>
						</div>
					) : (
						<div className="space-y-4 border-t pt-4">
							<label htmlFor="migration-confirm" className="flex items-start gap-3 text-sm">
								<Checkbox
									id="migration-confirm"
									checked={confirmed}
									onCheckedChange={(value) => setConfirmed(value === true)}
									disabled={pending}
									className="mt-0.5"
								/>
								<span>
									I reviewed the changes and notes. Copy configuration and readable values to this
									target; I will restore data and deploy separately.
								</span>
							</label>
							{blockers.length > 0 && (
								<p className="text-sm text-muted-foreground">
									Applying requires: {blockers.join(", ")}. Ask an organization administrator to
									grant the required capabilities.
								</p>
							)}
							<Button disabled={!confirmed || pending || blockers.length > 0} onClick={onApply}>
								{pending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<ArrowRight className="size-4" />
								)}
								{pending ? "Importing configuration…" : "Import configuration"}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>{result ? "Next steps before cutover" : "Prepare for cutover"}</CardTitle>
					<CardDescription>
						These tasks follow from the selected configuration. They are not completed by importing.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ol className="divide-y">
						{tasks.map((task, i) => (
							<li key={task.title} className="flex gap-3 py-3 first:pt-0 last:pb-0">
								<span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums">
									{i + 1}
								</span>
								<div className="min-w-0 space-y-1">
									<h3 className="text-sm font-medium">{task.title}</h3>
									<p className="text-sm text-muted-foreground">{task.detail}</p>
									{task.href && (
										<Link
											href={task.href}
											className="inline-flex items-center gap-1 rounded-sm text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											Open settings
											<ArrowRight className="size-3" />
										</Link>
									)}
								</div>
							</li>
						))}
					</ol>
				</CardContent>
			</Card>
		</div>
	);
}
