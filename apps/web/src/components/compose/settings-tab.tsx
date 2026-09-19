"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import { SettingsSection } from "@/components/layout/settings-section";
import { capabilityHint } from "@/components/services/capability-hint";
import { ServiceSettingsBody } from "@/components/services/service-settings-body";
import { Button } from "@/components/ui/button";
import { HelpLink } from "@/components/ui/help-link";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { toastError } from "@/lib/describe-error";
import { useTRPC, useTRPCClient } from "@/lib/trpc";

export function SettingsTab({
	projectId,
	compose,
}: {
	projectId: string;
	compose: ComposeService;
}) {
	const trpc = useTRPC();
	const trpcClient = useTRPCClient();
	const queryClient = useQueryClient();
	const router = useRouter();
	const composeId = compose.composeId;
	const { can } = useCapabilities();
	// The export carries env defaults, so it is gated like the env tab.
	const canExport = can("secrets.read");
	const [exporting, setExporting] = useState(false);

	const exportTemplate = async () => {
		setExporting(true);
		try {
			const result = await trpcClient.compose.exportTemplate.query({ composeId });
			const blob = new Blob([`${JSON.stringify(result.template, null, 2)}\n`], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `${result.template.id}.template.json`;
			anchor.click();
			URL.revokeObjectURL(url);
			toast.success(
				result.notes.length > 0
					? `Template exported — ${result.notes.length} value${result.notes.length === 1 ? "" : "s"} rewritten (secrets, hostnames)`
					: "Template exported",
			);
		} catch (error) {
			toastError(error, "Failed to export the template");
		} finally {
			setExporting(false);
		}
	};

	const update = useSaveMutation(trpc.compose.update.mutationOptions(), {
		successMessage: "Compose service updated",
		invalidate: [trpc.compose.one.queryKey({ composeId }), trpc.compose.all.pathKey()],
	});

	const remove = useSaveMutation(
		trpc.compose.delete.mutationOptions({
			onSuccess: () => router.push(`/dashboard/projects/${projectId}`),
		}),
		{ successMessage: "Compose service deleted", invalidate: [trpc.compose.all.queryKey()] },
	);

	const duplicate = useMutation(trpc.compose.duplicate.mutationOptions());
	// Separate from `update`: renaming the copy must not toast.
	const rename = useMutation(trpc.compose.update.mutationOptions());
	const move = useMutation(
		trpc.compose.move.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: trpc.compose.one.queryKey({ composeId }) }),
		}),
	);

	return (
		<>
			<ServiceSettingsBody
				kind="compose"
				name={compose.name}
				description={compose.description}
				projectId={projectId}
				environmentId={compose.environmentId}
				ops={{
					save: (input) => update.mutate({ composeId, ...input }),
					savePending: update.isPending,
					duplicate: async (environmentId) => {
						const created = await duplicate.mutateAsync({ composeId, environmentId });
						return created.composeId;
					},
					rename: (id, name) => rename.mutateAsync({ composeId: id, name }),
					move: (environmentId) => move.mutateAsync({ composeId, environmentId }),
					remove: () => remove.mutateAsync({ composeId }),
				}}
			/>
			<SettingsSection
				title="Export as template"
				description="Download this stack in the shape a template source serves: the compose file, env keys with their current values as defaults, secrets replaced with a generator placeholder and this stack's hostnames with {{domain}}. Put the file in a git repository or behind an https URL and add it as a template source on any instance."
				actions={
					<Button
						variant="outline"
						size="sm"
						disabled={!canExport || exporting}
						title={canExport ? undefined : capabilityHint("secrets.read")}
						onClick={() => void exportTemplate()}
					>
						{exporting ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Download className="size-4" />
						)}
						Export
					</Button>
				}
			>
				<p className="text-sm text-muted-foreground">
					Raw-source stacks only — a git-backed stack's file lives in the repository.{" "}
					<HelpLink slug="templates" />
				</p>
			</SettingsSection>
		</>
	);
}
