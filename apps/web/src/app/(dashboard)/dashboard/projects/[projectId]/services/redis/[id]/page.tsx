import { Suspense } from "react";

import { DatabaseDetail } from "@/components/databases/database-detail";

export default async function RedisServicePage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = await params;
	// DatabaseDetail reads useSearchParams (tab deep links) — Suspense boundary required.
	return (
		<Suspense>
			<DatabaseDetail type="redis" id={id} projectId={projectId} />
		</Suspense>
	);
}
