"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Server } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

type PlacementSwarm = {
	Constraints?: string[];
};

function constraintsFromPlacement(value: unknown): string {
	const placement = value as PlacementSwarm | null;
	return (placement?.Constraints ?? []).join("\n");
}

function placementFromConstraints(text: string): PlacementSwarm | null {
	const constraints = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (constraints.length === 0) return null;
	return { Constraints: constraints };
}

/** Swarm placement constraints (node.labels / node.role / …). */
export function PlacementManager({ application }: { application: Application }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [text, setText] = useState(() => constraintsFromPlacement(application.placementSwarm));

	const save = useMutation(
		trpc.application.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Placement constraints saved");
				await queryClient.invalidateQueries({ queryKey: trpc.application.one.queryKey() });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					<Server className="size-4" />
					Placement
				</span>
			}
			description={
				<>
					Docker Swarm constraints for where replicas run (one per line). Examples:{" "}
					<code className="text-xs">node.role==worker</code>,{" "}
					<code className="text-xs">node.labels.zone==eu</code>. Leave empty for any node.
				</>
			}
		>
			<div className="flex flex-col gap-3">
				<div className="grid gap-2">
					<Label htmlFor="placement-constraints">Constraints</Label>
					<textarea
						id="placement-constraints"
						className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-28 w-full rounded-md border px-3 py-2 font-mono text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
						value={text}
						onChange={(event) => setText(event.target.value)}
						placeholder={"node.role==worker\nnode.labels.disk==ssd"}
					/>
				</div>
				<Button
					type="button"
					disabled={save.isPending}
					onClick={() =>
						save.mutate({
							applicationId: application.applicationId,
							placementSwarm: placementFromConstraints(text),
						})
					}
					className="self-start"
				>
					{save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
					Save placement
				</Button>
			</div>
		</SettingsSection>
	);
}
