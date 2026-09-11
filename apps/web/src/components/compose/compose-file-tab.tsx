"use client";

import { yaml } from "@codemirror/lang-yaml";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ComposeService } from "@/components/compose/compose-detail";
import { GenerateComposeDialog } from "@/components/compose/generate-compose-dialog";
import { capabilityHint } from "@/components/services/capability-hint";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

export function ComposeFileTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	// The server nulls `composeFile` for members without secrets.read; the
	// editor cannot tell that apart from an empty file, so the capability
	// decides whether to show the (read-only) notice instead.
	const canRead = can("secrets.read");
	// Git-backed services are edited in the repository: the checkout is reset on
	// every deploy, and the server rejects saveComposeFile for them.
	const isGitSource = compose.sourceType !== "raw";
	const canWrite = canRead && can("service.write") && !isGitSource;
	const writeHint = isGitSource
		? "Edit the compose file in the repository — switch the source type to raw to edit it here"
		: capabilityHint("service.write");

	const serverFile = compose.composeFile ?? "";
	const [value, setValue] = useState(serverFile);
	const [locked, setLocked] = useState(true);
	useEffect(() => {
		if (locked) setValue(serverFile);
	}, [serverFile, locked]);
	// The blur lock only guards an existing file against accidental edits; an
	// empty (raw) file is editable right away. Read-only members keep the lock
	// with its hint.
	const hasContent = serverFile.trim().length > 0;
	const editable = canWrite && (!locked || !hasContent);
	const dirty = value !== serverFile;

	const servicesQuery = useQuery(
		trpc.compose.loadServices.queryOptions({ composeId: compose.composeId }),
	);

	const saveMutation = useMutation(
		trpc.compose.saveComposeFile.mutationOptions({
			onSuccess: async () => {
				toast.success("Compose file saved");
				// Lock only after compose.one holds the new YAML — locking first would
				// make the sync effect revert the editor to the previous file until
				// the refetch lands.
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.compose.one.queryKey({
							composeId: compose.composeId,
						}),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.compose.loadServices.queryKey({
							composeId: compose.composeId,
						}),
					}),
				]);
				setLocked(true);
			},
			onError: (error) => toastError(error),
		}),
	);

	const cancelEditing = () => {
		setValue(serverFile);
		setLocked(true);
	};

	const acceptDraft = (composeFile: string) => {
		if (!canWrite) {
			toast.error(writeHint);
			return;
		}
		setValue(composeFile);
		setLocked(false);
	};

	return (
		<SettingsStack>
			<SettingsSection
				title="Compose file"
				description={
					isGitSource ? (
						<>
							Read-only copy of{" "}
							<span className="font-mono">{compose.composePath || "docker-compose.yml"}</span> from
							the last checkout. Git-backed services are edited in the repository; switch the source
							type to raw to edit the file here.
						</>
					) : (
						<>This file is stored directly on the service. Use Copilot to draft or rewrite YAML.</>
					)
				}
				actions={
					<div className="flex items-center gap-2">
						{canRead && !isGitSource && <GenerateComposeDialog onAccept={acceptDraft} />}
						{editable && (
							<>
								<UnsavedChangesPill dirty={dirty} />
								{(!locked || dirty) && (
									<Button
										size="sm"
										variant="secondary"
										disabled={saveMutation.isPending}
										onClick={cancelEditing}
									>
										Cancel
									</Button>
								)}
								<DisabledHint hint={canWrite ? undefined : writeHint}>
									<Button
										size="sm"
										disabled={saveMutation.isPending || !dirty || !canWrite}
										onClick={() =>
											saveMutation.mutate({
												composeId: compose.composeId,
												composeFile: value,
											})
										}
									>
										{saveMutation.isPending ? "Saving…" : "Save"}
									</Button>
								</DisabledHint>
							</>
						)}
					</div>
				}
			>
				{!canRead ? (
					<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card py-10 text-center">
						<EyeOff className="size-6 text-muted-foreground" />
						<p className="text-sm font-medium">Compose file is hidden</p>
						<p className="max-w-sm text-sm text-muted-foreground">
							Viewing it requires the "secrets.read" capability. Editing is disabled so the stored
							file cannot be overwritten blindly.
						</p>
					</div>
				) : (
					<CodeEditor
						value={value}
						onChange={setValue}
						locked={!editable}
						placeholder={
							hasContent ? undefined : "No compose file yet — paste or generate YAML here"
						}
						onLockedChange={(next) => {
							// Git-backed files and members without service.write can view but never unlock.
							if (!next && !canWrite) return;
							if (!next) setValue(serverFile);
							setLocked(next);
						}}
						readOnly={!canWrite}
						extensions={[yaml()]}
						height="60vh"
						className="[&_.cm-editor]:min-h-[60vh] [&_.cm-editor]:text-sm"
						basicSetup={{ lineNumbers: true, foldGutter: true }}
						lockMessage={
							canWrite
								? "Locked to prevent accidental edits. Unlock to change the compose file."
								: `Read-only — ${writeHint}.`
						}
					/>
				)}
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
