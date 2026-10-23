"use client";

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
			<SourceConfig application={application} />
			{buildsFromSource ? <BuildTypeConfig application={application} /> : <BuildTypeInfoCard />}
			<ResourcesForm application={application} />
		</SettingsStack>
	);
}
