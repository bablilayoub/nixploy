"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { SettingsSection } from "@/components/layout/settings-section";
import { capabilityHint } from "@/components/services/capability-hint";
import { useSaveBar } from "@/components/services/save-bar";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

const NO_REGISTRY = "none";

/**
 * Deploy-time knobs that are neither source nor build: the pre/post-deploy
 * hooks and the optional registry the built image is pushed to. Mounted on
 * the Deploy tab (`deployments-tab.tsx`) next to the history and deploy hook.
 */
export function DeployCommandsCard({ application }: { application: Application }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;

	// Background refetches must not wipe what is being typed.
	const draft = useDraft({
		preDeploy: application.preDeployCommand ?? "",
		postDeploy: application.postDeployCommand ?? "",
		pushRegistryId: application.pushRegistryId ?? NO_REGISTRY,
	});
	const { preDeploy, postDeploy, pushRegistryId } = draft.value;

	const registries = useQuery(trpc.registry.all.queryOptions());
	// Only a registry with a namespace can be a push target — the pushed tag is
	// `<imagePrefix>/<appName>:<version>`.
	const pushable = (registries.data ?? []).filter((row) => Boolean(row.imagePrefix?.trim()));

	const update = useSaveMutation(trpc.application.update.mutationOptions(), {
		successMessage: "Deploy settings saved",
		invalidate: [trpc.application.one.queryKey({ applicationId })],
		onSuccess: draft.markSaved,
	});

	const canWrite = can("service.write") && can("secrets.write");
	const hint = canWrite ? undefined : capabilityHint("secrets.write");

	const onSave = () =>
		update.mutate({
			applicationId,
			preDeployCommand: preDeploy.trim() || null,
			postDeployCommand: postDeploy.trim() || null,
			pushRegistryId: pushRegistryId === NO_REGISTRY ? null : pushRegistryId,
		});

	useSaveBar(draft, { onSave, pending: update.isPending, disabled: !canWrite });

	return (
		<SettingsSection
			title="Deploy commands"
			description="Run a command around the rollout — a database migration before it, a cache warm-up after it."
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="pre-deploy-command">Pre-deploy command</Label>
					<Textarea
						id="pre-deploy-command"
						className="min-h-16 font-mono text-xs sm:max-w-lg"
						placeholder="npm run migrate"
						value={preDeploy}
						disabled={!canWrite}
						onChange={(event) => draft.patch({ preDeploy: event.target.value })}
					/>
					<p className="text-xs text-muted-foreground">
						Runs in a throwaway container from the image this deploy built, on the environment's
						private network, with the service's environment variables. A non-zero exit aborts the
						deployment and the current version keeps serving. Previews never run it. The image needs
						a shell — a scratch or distroless image cannot run a hook.
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="post-deploy-command">Post-deploy command</Label>
					<Textarea
						id="post-deploy-command"
						className="min-h-16 font-mono text-xs sm:max-w-lg"
						placeholder="npm run cache:warm"
						value={postDeploy}
						disabled={!canWrite}
						onChange={(event) => draft.patch({ postDeploy: event.target.value })}
					/>
					<p className="text-xs text-muted-foreground">
						Runs inside one running container once the rollout has converged. A non-zero exit marks
						the deployment failed.
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="push-registry">Push built image to</Label>
					<Select
						value={pushRegistryId}
						disabled={!canWrite}
						onValueChange={(value) => draft.patch({ pushRegistryId: value })}
					>
						<SelectTrigger id="push-registry" className="sm:max-w-sm">
							<SelectValue placeholder="Don't push" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NO_REGISTRY}>Don't push</SelectItem>
							{pushable.map((row) => (
								<SelectItem key={row.registryId} value={row.registryId}>
									{row.registryName} ({row.imagePrefix})
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">
						A built image only exists on the node that built it. Pushing it lets replicas on other
						nodes — and rollbacks after a node swap — pull it. Only registries with an image prefix
						can be a target.
					</p>
				</div>

				<div className="flex items-center justify-end gap-3">
					<UnsavedChangesPill dirty={draft.dirty} />
					<DisabledHint hint={hint}>
						<Button disabled={!canWrite || update.isPending} onClick={onSave}>
							{update.isPending && <Loader2 className="size-4 animate-spin" />}
							Save
						</Button>
					</DisabledHint>
				</div>
			</div>
		</SettingsSection>
	);
}
