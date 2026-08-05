import { DatabaseDetail } from "@/components/databases/database-detail";

export default async function MariadbServicePage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = await params;
	return <DatabaseDetail type="mariadb" id={id} projectId={projectId} />;
}
