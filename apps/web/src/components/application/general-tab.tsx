"use client";

import { SettingsStack } from "@/components/settings/settings-section";
import { BuildTypeConfig, BuildTypeInfoCard } from "./build-type-config";
import { ResourcesForm } from "./resources-form";
import { SourceConfig } from "./source-config";
import type { Application } from "./types";

export function GeneralTab({ application }: { application: Application }) {
	const buildsFromSource = application.sourceType !== "docker" && application.sourceType !== "drop";
	return (
		<SettingsStack>
			<SourceConfig application={application} />
			{buildsFromSource ? (
				<BuildTypeConfig application={application} />
			) : (
				<BuildTypeInfoCard sourceType={application.sourceType} />
			)}
			<ResourcesForm application={application} />
		</SettingsStack>
	);
}
