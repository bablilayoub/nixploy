"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	Container,
	FileCode2,
	Layers,
	Loader2,
	Package,
	Sparkles,
	Boxes as StackIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/settings-section";
import { capabilityHint } from "@/components/services/capability-hint";
import { useSaveBar } from "@/components/services/save-bar";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

import type { Application } from "./types";

type BuildType = Application["buildType"];

const BUILD_TYPES: {
	value: BuildType;
	label: string;
	description: string;
	icon: typeof Package;
}[] = [
	{
		value: "nixpacks",
		label: "Nixpacks",
		description: "Auto-detect your stack and build with Nix (Railway).",
		icon: Package,
	},
	{
		value: "railpack",
		label: "Railpack",
		description: "Railway's next-gen builder, smaller images.",
		icon: Sparkles,
	},
	{
		value: "dockerfile",
		label: "Dockerfile",
		description: "Build from a Dockerfile in your repo.",
		icon: Container,
	},
	{
		value: "static",
		label: "Static",
		description: "Serve pre-built assets with nginx.",
		icon: FileCode2,
	},
	{
		value: "heroku_buildpacks",
		label: "Heroku Buildpacks",
		description: "Classic Cloud Native Buildpacks (Heroku builder).",
		icon: Layers,
	},
	{
		value: "paketo_buildpacks",
		label: "Paketo Buildpacks",
		description: "Cloud Native Buildpacks (Paketo builder).",
		icon: StackIcon,
	},
];

export function BuildTypeConfig({ application }: { application: Application }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;

	// The draft mirrors server values while the user is not editing —
	// background refetches (deploy status flips, window focus) must not wipe
	// typed text.
	const draft = useDraft<{
		buildType: BuildType;
		dockerfile: string;
		dockerContextPath: string;
		dockerBuildStage: string;
		publishDirectory: string;
		isStaticSpa: boolean;
		buildArgs: string;
		useBuildCache: boolean;
	}>({
		buildType: application.buildType,
		dockerfile: application.dockerfile ?? "Dockerfile",
		dockerContextPath: application.dockerContextPath ?? "",
		dockerBuildStage: application.dockerBuildStage ?? "",
		publishDirectory: application.publishDirectory ?? "",
		isStaticSpa: application.isStaticSpa ?? false,
		buildArgs: application.buildArgs ?? "",
		useBuildCache: application.useBuildCache ?? true,
	});
	const {
		buildType,
		dockerfile,
		dockerContextPath,
		dockerBuildStage,
		publishDirectory,
		isStaticSpa,
		buildArgs,
		useBuildCache,
	} = draft.value;

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.application.one.queryKey({ applicationId }),
		});

	const saveBuildType = useMutation(
		trpc.application.saveBuildType.mutationOptions({
			onError: (error) => toastError(error),
		}),
	);
	const update = useMutation(
		trpc.application.update.mutationOptions({
			onError: (error) => toastError(error),
		}),
	);

	const isPending = saveBuildType.isPending || update.isPending;
	const buildArgsChanged = (application.buildArgs ?? "") !== buildArgs;
	const canWrite = can("service.write");
	const canWriteSecrets = can("secrets.write");
	// Build args may contain secrets; the server requires secrets.write to change them.
	const saveBlocked = !canWrite || (buildArgsChanged && !canWriteSecrets);
	const saveHint = !canWrite
		? capabilityHint("service.write")
		: buildArgsChanged && !canWriteSecrets
			? capabilityHint("secrets.write")
			: undefined;

	const onSave = async () => {
		try {
			await saveBuildType.mutateAsync({
				applicationId,
				buildType,
				dockerfile: buildType === "dockerfile" ? dockerfile || null : null,
				dockerContextPath: buildType === "dockerfile" ? dockerContextPath || null : null,
				dockerBuildStage: buildType === "dockerfile" ? dockerBuildStage || null : null,
				publishDirectory: buildType === "static" ? publishDirectory || null : null,
				isStaticSpa: buildType === "static" ? isStaticSpa : null,
				useBuildCache,
			});
			if (buildArgsChanged) {
				await update.mutateAsync({
					applicationId,
					buildArgs: buildArgs || null,
				});
			}
			toast.success("Build configuration saved");
			await invalidate();
			// Refetch is done: the server now holds what was typed.
			draft.markSaved();
		} catch {
			// errors are surfaced via onError toasts
		}
	};

	useSaveBar(draft, { onSave, pending: isPending, disabled: saveBlocked });

	return (
		<SettingsSection title="Build" description="How the source is built into a deployable image.">
			<div className="flex flex-col gap-5">
				<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{BUILD_TYPES.map((option) => (
						<button
							key={option.value}
							type="button"
							onClick={() => draft.patch({ buildType: option.value })}
							className={cn(
								"flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
								buildType === option.value
									? "border-foreground bg-secondary/60 ring-1 ring-foreground"
									: "border-border hover:border-foreground/40 hover:bg-secondary/40",
							)}
						>
							<span className="flex items-center gap-2 text-sm font-medium">
								<option.icon className="size-4 text-muted-foreground" />
								{option.label}
							</span>
							<span className="text-xs text-muted-foreground">{option.description}</span>
						</button>
					))}
				</div>

				{buildType === "dockerfile" && (
					<div className="grid gap-4 sm:grid-cols-3">
						<div className="flex flex-col gap-2">
							<Label htmlFor="dockerfile">Dockerfile path</Label>
							<Input
								id="dockerfile"
								placeholder="Dockerfile"
								value={dockerfile}
								onChange={(e) => draft.patch({ dockerfile: e.target.value })}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="docker-context">Build context</Label>
							<Input
								id="docker-context"
								placeholder="."
								value={dockerContextPath}
								onChange={(e) => draft.patch({ dockerContextPath: e.target.value })}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="docker-stage">Build Stage (optional)</Label>
							<Input
								id="docker-stage"
								placeholder="builder"
								value={dockerBuildStage}
								onChange={(e) => draft.patch({ dockerBuildStage: e.target.value })}
							/>
						</div>
					</div>
				)}

				{buildType === "static" && (
					<>
						<div className="flex flex-col gap-2">
							<Label htmlFor="publish-dir">Publish directory</Label>
							<Input
								id="publish-dir"
								placeholder="dist"
								className="sm:max-w-xs"
								value={publishDirectory}
								onChange={(e) => draft.patch({ publishDirectory: e.target.value })}
							/>
							<p className="text-xs text-muted-foreground">
								Directory with the compiled assets, relative to the repo root. No build step runs.
							</p>
						</div>
						<div className="flex items-center justify-between rounded-md border p-3">
							<div className="flex flex-col gap-1">
								<Label htmlFor="is-spa">Single-page application</Label>
								<p className="text-xs text-muted-foreground">
									Rewrite all paths to index.html (React, Vue, etc.).
								</p>
							</div>
							<Switch
								id="is-spa"
								checked={isStaticSpa}
								onCheckedChange={(checked) => draft.patch({ isStaticSpa: checked })}
							/>
						</div>
					</>
				)}

				{(buildType === "nixpacks" || buildType === "railpack" || buildType === "dockerfile") && (
					<>
						<div className="flex items-center justify-between rounded-md border p-3">
							<div className="flex flex-col gap-1">
								<Label htmlFor="use-build-cache">Use build cache</Label>
								<p className="text-xs text-muted-foreground">
									Reuse BuildKit layers between deploys (faster rebuilds). Turn off for a clean
									build.
								</p>
							</div>
							<Switch
								id="use-build-cache"
								checked={useBuildCache}
								onCheckedChange={(checked) => draft.patch({ useBuildCache: checked })}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="build-args">Build args</Label>
							<Textarea
								id="build-args"
								placeholder={"NODE_ENV=production\nSOME_FLAG=1"}
								className="min-h-24 font-mono text-sm"
								value={buildArgs}
								onChange={(e) => draft.patch({ buildArgs: e.target.value })}
							/>
							<p className="text-xs text-muted-foreground">
								One KEY=value pair per line, passed to the builder at build time.
							</p>
						</div>
					</>
				)}

				<div className="flex items-center justify-end gap-3">
					<UnsavedChangesPill dirty={draft.dirty} />
					<DisabledHint hint={saveHint}>
						<Button onClick={onSave} disabled={isPending || saveBlocked}>
							{isPending && <Loader2 className="size-4 animate-spin" />}
							Save build
						</Button>
					</DisabledHint>
				</div>
			</div>
		</SettingsSection>
	);
}

/** Shown for a docker source: no build step, the image is used as-is. */
export function BuildTypeInfoCard() {
	return (
		<SettingsSection title="Build" description="How the source is built into a deployable image.">
			<div className="flex items-start gap-3 rounded-lg border border-dashed border-border p-4">
				<Container className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<p className="text-sm text-muted-foreground">
					This application deploys a pre-built <strong>Docker image</strong> — there is no build
					step. To build from source instead, switch the source type to Git or a zip upload and pick
					a builder here (Nixpacks, Railpack, Dockerfile, Static, buildpacks).
				</p>
			</div>
		</SettingsSection>
	);
}
