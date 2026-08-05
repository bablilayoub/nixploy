import { DatabaseDetail } from "@/components/databases/database-detail";

export default async function MysqlServicePage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = await params;
	return <DatabaseDetail type="mysql" id={id} projectId={projectId} />;
}
