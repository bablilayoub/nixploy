"use client";

import { SettingsStack } from "@/components/layout/settings-section";
import { useApplication } from "./application-context";
import { BuildTypeConfig, BuildTypeInfoCard } from "./build-type-config";
import { ResourcesForm } from "./resources-form";
import { SourceConfig } from "./source-config";

export function GeneralTab() {
	const application = useApplication();
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
