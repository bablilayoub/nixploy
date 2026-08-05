import { DatabaseDetail } from "@/components/databases/database-detail";

export default async function MongoServicePage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = await params;
	return <DatabaseDetail type="mongo" id={id} projectId={projectId} />;
}
