import type { Metadata } from "next";
import { Suspense } from "react";

import { ComposeDetail } from "@/components/compose/compose-detail";

export const metadata: Metadata = {
	title: "Compose Service",
};

export default async function ComposeServicePage({
	params,
}: {
	params: Promise<{ projectId: string; composeId: string }>;
}) {
	const { projectId, composeId } = await params;
	// ComposeDetail reads useSearchParams (tab deep links) — Suspense boundary required.
	return (
		<Suspense>
			<ComposeDetail projectId={projectId} composeId={composeId} />
		</Suspense>
	);
}
