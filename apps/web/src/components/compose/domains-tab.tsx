"use client";

import { useQuery } from "@tanstack/react-query";

import type { ComposeService } from "@/components/compose/compose-detail";
import { DomainManager } from "@/components/services/domain-manager";
import { useTRPC } from "@/lib/trpc";

export function DomainsTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();

	// Compose domains target one service of the compose file.
	const { data: serviceNames } = useQuery(
		trpc.compose.loadServices.queryOptions({ composeId: compose.composeId }),
	);

	return (
		<DomainManager
			serviceType="compose"
			serviceId={compose.composeId}
			composeServices={serviceNames ?? []}
		/>
	);
}
