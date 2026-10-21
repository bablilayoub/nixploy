"use client";

import { SectionLinks } from "@/components/layout/section-links";
import { SettingsStack } from "@/components/layout/settings-section";
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
		<SettingsStack>
			<SectionLinks
				label="Application configuration sections"
				items={[
					{
						id: "application-source",
						label: "Source",
						detail:
							application.sourceType === "docker"
								? "Container image"
								: "Repository or uploaded source",
					},
					{
						id: "application-build",
						label: "Build",
						detail: buildsFromSource ? "Builder and build settings" : "Pre-built image",
					},
					{
						id: "application-resources",
						label: "Resources",
						detail: `${application.replicas} ${application.replicas === 1 ? "replica" : "replicas"} · CPU and memory`,
					},
				]}
			/>
			<div id="application-source" tabIndex={-1} className="fieldwork-form-group">
				<SourceConfig application={application} />
			</div>
			<div id="application-build" tabIndex={-1} className="fieldwork-form-group">
				{buildsFromSource ? <BuildTypeConfig application={application} /> : <BuildTypeInfoCard />}
			</div>
			<div id="application-resources" tabIndex={-1} className="fieldwork-form-group">
				<ResourcesForm application={application} />
			</div>
		</SettingsStack>
	);
}
