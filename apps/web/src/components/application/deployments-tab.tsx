"use client";

import { ChevronDown } from "lucide-react";
import { buildCommitUrl, DeploymentHistory } from "@/components/services/deployment-history";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { DeployCommandsCard } from "./deploy-commands-card";
import { DeployHookCard } from "./deploy-hook-card";

import type { Application } from "./types";

export function DeploymentsTab({ application }: { application: Application }) {
	return (
		<div className="space-y-6">
			<Collapsible id="deployment-automation" className="group rounded-xl border bg-card">
				<CollapsibleTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="group h-auto w-full justify-start flex-wrap cursor-pointer rounded-xl px-5 py-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
					>
						Deployment automation
						<span className="mt-1 block text-wrap font-normal text-muted-foreground sm:ml-2 sm:mt-0 sm:inline">
							Commands and deploy hook
						</span>
						<ChevronDown
							aria-hidden="true"
							className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
						/>
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent forceMount className="data-[state=closed]:hidden">
					<div className="border-t px-5 py-5 sm:px-6">
						<DeployCommandsCard application={application} />
						<DeployHookCard appName={application.appName} />
					</div>
				</CollapsibleContent>
			</Collapsible>
			<DeploymentHistory
				kind="application"
				serviceId={application.applicationId}
				description="Build and deployment history for this application."
				canCancel
				commitUrl={(sha) =>
					buildCommitUrl(
						{
							sourceType: application.sourceType,
							owner: application.owner,
							repository: application.repository,
							gitUrl: application.gitUrl,
							providerUrl: application.gitlab?.gitlabUrl ?? application.gitea?.giteaUrl ?? null,
						},
						sha,
					)
				}
			/>
		</div>
	);
}
