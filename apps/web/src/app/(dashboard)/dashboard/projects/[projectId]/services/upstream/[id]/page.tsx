import { UpstreamDetail } from "@/components/upstreams/upstream-detail";

export default async function ExternalUpstreamPage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = await params;
	return <UpstreamDetail projectId={projectId} externalUpstreamId={id} />;
}
