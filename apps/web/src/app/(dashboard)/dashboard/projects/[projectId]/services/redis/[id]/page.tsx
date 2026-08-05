import { DatabaseDetail } from "@/components/databases/database-detail";

export default async function RedisServicePage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = await params;
	return <DatabaseDetail type="redis" id={id} projectId={projectId} />;
}
