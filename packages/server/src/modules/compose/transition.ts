import { preconditionFailed } from "../errors";
import {
	COMPOSE_SOURCE_SERVICE_LABEL,
	type ComposeCommandRow,
	deployedServiceName,
	stackServiceName,
} from "./commands";
import { shellQuote } from "./paths";

interface InspectedContainer {
	Config?: { Labels?: Record<string, string> };
	Mounts?: Array<{ Type?: string; Name?: string; Destination?: string }>;
}

/**
 * Qualifying old service keys recreates containers. Named volumes retain their
 * project-scoped names, but Docker cannot transfer an anonymous/image VOLUME
 * from the old service identity to the new one. Refuse that transition before
 * replacing the rendered file or removing any old container. Upgraded renders
 * carry source metadata and ordinary redeploys keep their anonymous volumes.
 */
export async function assertSafeComposeNamingTransition(
	row: ComposeCommandRow,
	run: (command: string) => Promise<string>,
): Promise<void> {
	if (row.composeType === "stack") {
		// Service renaming is not a rolling update: a new database could start
		// before the old task releases its local volume. Refuse every legacy
		// service, even when its tasks are remote or no local container exists.
		const ids = (
			await run(
				`docker service ls -q --no-trunc --filter label=com.docker.stack.namespace=${shellQuote(row.appName)}`,
			)
		)
			.split("\n")
			.map((id) => id.trim())
			.filter(Boolean);
		if (ids.length === 0) return;
		if (ids.some((id) => !/^[a-z0-9]{25}$/.test(id)))
			throw preconditionFailed(
				"Could not verify existing Swarm services before the naming upgrade",
			);
		const services = JSON.parse(
			await run(`docker service inspect ${ids.map(shellQuote).join(" ")}`),
		) as Array<{
			Spec?: {
				Name?: string;
				Labels?: Record<string, string>;
				TaskTemplate?: { ContainerSpec?: { Labels?: Record<string, string> } };
			};
		}>;
		if (services.length !== ids.length)
			throw preconditionFailed(
				"Could not verify every existing Swarm service before the naming upgrade",
			);
		for (const service of services) {
			const spec = service.Spec;
			if (spec?.Labels?.["com.docker.stack.namespace"] !== row.appName)
				throw preconditionFailed(
					"Could not verify existing Swarm service ownership before the naming upgrade",
				);
			const source = spec.TaskTemplate?.ContainerSpec?.Labels?.[COMPOSE_SOURCE_SERVICE_LABEL];
			if (source && spec.Name === stackServiceName(row, source)) continue;
			throw preconditionFailed(
				"Existing Swarm stack uses legacy service names. Before stopping, back up or copy any anonymous/image volumes to declared named volumes and verify the target node placement and volume access. Then explicitly stop the stack, wait for every old task to stop, and deploy again. Automatic renaming was refused to prevent overlapping database tasks or losing local data; existing services and volumes were left intact.",
			);
		}
		return;
	}
	const output = await run(
		`docker ps -aq --filter label=com.docker.compose.project=${shellQuote(row.appName)}`,
	);
	const ids = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (ids.length === 0) return;
	if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) {
		throw preconditionFailed(
			"Could not verify existing Compose containers before the naming upgrade",
		);
	}
	const inspected = JSON.parse(
		await run(`docker inspect ${ids.map(shellQuote).join(" ")}`),
	) as InspectedContainer[];
	for (const container of inspected) {
		const labels = container.Config?.Labels;
		if (
			labels?.["com.docker.compose.project"] !== row.appName ||
			!labels["com.docker.compose.service"] ||
			(labels[COMPOSE_SOURCE_SERVICE_LABEL] &&
				labels["com.docker.compose.service"] ===
					deployedServiceName(row, labels[COMPOSE_SOURCE_SERVICE_LABEL]))
		)
			continue;
		for (const mount of container.Mounts ?? []) {
			if (mount.Type !== "volume" || !/^[a-f0-9]{64}$/.test(mount.Name ?? "")) continue;
			throw preconditionFailed(
				`Existing service ${labels["com.docker.compose.service"]} has an anonymous volume at ${mount.Destination ?? "an unknown path"}. Back up or copy the data to a declared named volume, then remove the stopped legacy containers while keeping their volumes before deploying again. Existing containers and volumes were left intact.`,
			);
		}
	}
}
