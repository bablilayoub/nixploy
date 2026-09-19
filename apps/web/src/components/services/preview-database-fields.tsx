"use client";

import { useQuery } from "@tanstack/react-query";

import { HelpLink } from "@/components/ui/help-link";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/lib/trpc";

const NONE = "__none__";

/**
 * The per-preview database knobs, shared by the application and compose
 * preview settings cards: which database service of the environment gets a
 * logical database per preview, and the command that seeds it once.
 * `databaseTarget` is `<kind>:<id>` or "" — one draft field, split on save.
 */
export function PreviewDatabaseFields({
	target,
	databaseTarget,
	seedCommand,
	disabled,
	idPrefix,
	onChange,
}: {
	target: { applicationId: string } | { composeId: string };
	databaseTarget: string;
	seedCommand: string;
	disabled: boolean;
	idPrefix: string;
	onChange: (patch: { databaseTarget?: string; seedCommand?: string }) => void;
}) {
	const trpc = useTRPC();
	const targets = useQuery(trpc.previewDeployment.databaseTargets.queryOptions(target));
	const options = targets.data ?? [];
	const selected = options.some((row) => `${row.kind}:${row.id}` === databaseTarget)
		? databaseTarget
		: NONE;

	return (
		<>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`${idPrefix}-database`}>Database per preview</Label>
				<Select
					value={selected}
					disabled={disabled || targets.isPending}
					onValueChange={(value) => onChange({ databaseTarget: value === NONE ? "" : value })}
				>
					<SelectTrigger id={`${idPrefix}-database`} className="sm:max-w-lg">
						<SelectValue placeholder="None — previews use the environment variables above" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={NONE}>None — previews use the variables above</SelectItem>
						{options.map((row) => (
							<SelectItem key={`${row.kind}:${row.id}`} value={`${row.kind}:${row.id}`}>
								{row.name} <span className="text-muted-foreground">({row.kind})</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-xs text-muted-foreground">
					Each preview gets its own database on this service, handed to it as{" "}
					<code className="font-mono">DATABASE_URL</code> and dropped with the preview. Only the
					databases of this environment are offered. <HelpLink slug="domains" />
				</p>
			</div>
			{selected !== NONE ? (
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${idPrefix}-seed`}>Seed command (optional)</Label>
					<Textarea
						id={`${idPrefix}-seed`}
						className="min-h-16 font-mono text-xs sm:max-w-lg"
						placeholder="npx prisma migrate deploy && node scripts/seed.js"
						value={seedCommand}
						disabled={disabled}
						onChange={(event) => onChange({ seedCommand: event.target.value })}
					/>
					<p className="text-xs text-muted-foreground">
						Runs once per preview with its fresh database, before the first rollout — in the
						preview's own image for an application, in a container of the preview project for a
						compose stack.
					</p>
				</div>
			) : null}
		</>
	);
}
