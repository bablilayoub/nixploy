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

	return <ProjectDetail projectId={projectId} initialEnvironment={env} initialTab={tab} />;
}
