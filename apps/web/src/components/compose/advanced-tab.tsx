"use client";

import { useQuery } from "@tanstack/react-query";

import { MountsManager } from "@/components/application/mounts-manager";
import type { ComposeService } from "@/components/compose/compose-detail";
import { useTRPC } from "@/lib/trpc";

/**
 * Advanced settings of a compose stack. Mounts only, for now: a stack can
 * declare its own named volumes inline, but a bind or file mount has to come
 * from a validated row (the compose file itself may not declare one), and it
 * has to say which service of the stack it belongs to.
 */
export function AdvancedTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const { data: serviceNames } = useQuery(
		trpc.compose.loadServices.queryOptions({ composeId: compose.composeId }),
	);

	return (
		<MountsManager
			target={{
				kind: "compose",
				composeId: compose.composeId,
				serviceNames: serviceNames ?? [],
			}}
		/>
	);
}
