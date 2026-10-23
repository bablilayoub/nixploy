"use client";

import { FocusSections } from "@/components/layout/focus-sections";
import { useApplication } from "./application-context";
import { BuildTypeConfig, BuildTypeInfoCard } from "./build-type-config";
import { ResourcesForm } from "./resources-form";
import { SourceConfig } from "./source-config";

export function GeneralTab() {
	const application = useApplication();
	// Only a pre-built image skips the builder. A `drop` upload is extracted
	// into the code directory and built exactly like a git checkout — the
	// worker runs `buildImage` for it (deployment/worker.ts), so hiding the
	// picker left the build type unreachable for the one source that most
	// needs it set.
	const buildsFromSource = application.sourceType !== "docker";
	return (
		<FocusSections
			label="Application configuration sections"
			items={[
				{
					id: "application-source",
					label: "Source",
				},
				{
					id: "application-build",
					label: "Build",
				},
				{
					id: "application-resources",
					label: "Resources",
				},
			]}
		>
			<div id="application-source" tabIndex={-1} className="space-y-6 scroll-mt-24 min-w-0">
				<SourceConfig application={application} />
			</div>
			<div id="application-build" tabIndex={-1} className="space-y-6 scroll-mt-24 min-w-0">
				{buildsFromSource ? <BuildTypeConfig application={application} /> : <BuildTypeInfoCard />}
			</div>
			<div id="application-resources" tabIndex={-1} className="space-y-6 scroll-mt-24 min-w-0">
				<ResourcesForm application={application} />
			</div>
		</FocusSections>
	);
}
