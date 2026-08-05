import { DatabaseDetail } from "@/components/databases/database-detail";

export default async function PostgresServicePage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = await params;
	return <DatabaseDetail type="postgres" id={id} projectId={projectId} />;
}
