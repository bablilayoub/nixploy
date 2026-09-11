import { Suspense } from "react";

import { ApplicationDetail, PageSkeleton } from "@/components/application/application-detail";

export default async function ApplicationServicePage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = await params;
	// ApplicationDetail reads useSearchParams (tab deep links) — Suspense boundary required.
	return (
		<Suspense fallback={<PageSkeleton />}>
			<ApplicationDetail projectId={projectId} id={id} />
		</Suspense>
	);
}
