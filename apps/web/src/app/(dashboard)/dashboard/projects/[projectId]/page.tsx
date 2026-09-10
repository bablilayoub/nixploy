import { Suspense } from "react";

import { ProjectDetail } from "@/components/projects/project-detail";

export default async function ProjectPage({
	params,
	searchParams,
}: {
	params: Promise<{ projectId: string }>;
	searchParams: Promise<{ env?: string; tab?: string }>;
}) {
	const { projectId } = await params;
	const { env, tab } = await searchParams;

	// ProjectDetail reads useSearchParams (?new= deep link) — Suspense boundary required.
	return (
		<Suspense>
			<ProjectDetail projectId={projectId} initialEnvironment={env} initialTab={tab} />
		</Suspense>
	);
}
