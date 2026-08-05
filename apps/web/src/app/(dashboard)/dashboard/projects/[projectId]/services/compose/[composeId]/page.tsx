import type { Metadata } from "next";

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
	return <ComposeDetail projectId={projectId} composeId={composeId} />;
}
