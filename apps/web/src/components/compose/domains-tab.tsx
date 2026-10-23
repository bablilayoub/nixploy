"use client";

import { useQuery } from "@tanstack/react-query";

import { RedirectsManager } from "@/components/application/redirects-manager";
import { SecurityManager } from "@/components/application/security-manager";
import type { ComposeService } from "@/components/compose/compose-detail";
import { DomainManager } from "@/components/services/domain-manager";
import { useTRPC } from "@/lib/trpc";

export function DomainsTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();

	// Compose domains target one service of the compose file.
	const { data: serviceNames } = useQuery(
		trpc.compose.loadServices.queryOptions({ composeId: compose.composeId }),
	);
	const { data: domains } = useQuery(
		trpc.domain.byCompose.queryOptions({ composeId: compose.composeId }),
	);

	// Redirects and basic auth are rendered into the routed service's own
	// Traefik file, so they only make sense for services that have a domain.
	const routedServices = [
		...new Set((domains ?? []).map((domain) => domain.serviceName).filter(Boolean)),
	].sort() as string[];

	return (
		<div className="flex flex-col gap-6">
			<DomainManager
				serviceType="compose"
				serviceId={compose.composeId}
				composeServices={serviceNames ?? []}
			/>
			{routedServices.map((serviceName) => (
				<div key={serviceName} className="flex flex-col gap-6">
					<RedirectsManager composeId={compose.composeId} serviceName={serviceName} />
					<SecurityManager composeId={compose.composeId} serviceName={serviceName} />
				</div>
			))}
		</div>
	);
}
