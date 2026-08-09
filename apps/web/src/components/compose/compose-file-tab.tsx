"use client";

import { yaml } from "@codemirror/lang-yaml";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import { GenerateComposeDialog } from "@/components/compose/generate-compose-dialog";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

export function ComposeFileTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [value, setValue] = useState(compose.composeFile);
	const [locked, setLocked] = useState(true);
	useEffect(() => {
		if (locked) setValue(compose.composeFile);
	}, [compose.composeFile, locked]);

	const servicesQuery = useQuery(
		trpc.compose.loadServices.queryOptions({ composeId: compose.composeId }),
	);

	const saveMutation = useMutation(
		trpc.compose.saveComposeFile.mutationOptions({
			onSuccess: () => {
				toast.success("Compose file saved");
				setLocked(true);
				queryClient.invalidateQueries({
					queryKey: trpc.compose.one.queryKey({ composeId: compose.composeId }),
				});
				queryClient.invalidateQueries({
					queryKey: trpc.compose.loadServices.queryKey({
						composeId: compose.composeId,
					}),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const cancelEditing = () => {
		setValue(compose.composeFile);
		setLocked(true);
	};

	const acceptDraft = (composeFile: string) => {
		setValue(composeFile);
		setLocked(false);
	};

	return (
		<SettingsStack>
			<SettingsSection
				title="Compose File"
				description={
					<>
						{compose.sourceType === "raw"
							? "This file is stored directly on the service."
							: "Overwrites the compose file inside the local clone of the source."}{" "}
						Use Copilot to draft or rewrite YAML.
					</>
				}
				actions={
					<div className="flex items-center gap-2">
						<GenerateComposeDialog onAccept={acceptDraft} />
						{!locked && (
							<>
								<Button
									size="sm"
									variant="secondary"
									disabled={saveMutation.isPending}
									onClick={cancelEditing}
								>
									Cancel
								</Button>
								<Button
									size="sm"
									disabled={saveMutation.isPending || value === compose.composeFile}
									onClick={() =>
										saveMutation.mutate({
											composeId: compose.composeId,
											composeFile: value,
										})
									}
								>
									{saveMutation.isPending ? "Saving…" : "Save"}
								</Button>
							</>
						)}
					</div>
				}
			>
				<CodeEditor
					value={value}
					onChange={setValue}
					locked={locked}
					onLockedChange={(next) => {
						if (!next) setValue(compose.composeFile);
						setLocked(next);
					}}
					extensions={[yaml()]}
					height="60vh"
					className="[&_.cm-editor]:min-h-[60vh] [&_.cm-editor]:text-sm"
					basicSetup={{ lineNumbers: true, foldGutter: true }}
					lockMessage="Locked to prevent accidental edits. Unlock to change the compose file."
				/>
			</SettingsSection>

			<SettingsSection
				title="Services"
				description="Services defined by the compose file — used for domains and logs."
			>
				{servicesQuery.isLoading ? (
					<div className="flex flex-wrap gap-2">
						<Skeleton className="h-6 w-24" />
						<Skeleton className="h-6 w-24" />
					</div>
				) : servicesQuery.isError ? (
					<p className="text-sm text-muted-foreground">
						Could not load services — the compose file may not be available yet. Deploy once, or fix
						the compose file.
					</p>
				) : (servicesQuery.data ?? []).length === 0 ? (
					<p className="text-sm text-muted-foreground">No services found in the compose file.</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{(servicesQuery.data ?? []).map((serviceName) => (
							<Badge key={serviceName} variant="secondary">
								{serviceName}
							</Badge>
						))}
					</div>
				)}
			</SettingsSection>
		</SettingsStack>
	);
}
