"use client";

import { type QueryClient, useQuery } from "@tanstack/react-query";
import { Container, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useMounted } from "@/hooks/use-mounted";
import { authClient } from "@/lib/auth-client";
import { capabilityLabel } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";

import { ContainersTab } from "./containers-tab";
import { ImagesTab } from "./images-tab";
import { NetworksTab } from "./networks-tab";
import { SwarmTab } from "./swarm-tab";
import { SystemTab } from "./system-tab";
import { VolumesTab } from "./volumes-tab";

export interface DockerTabProps {
	/** null = the Nixploy host itself. */
	serverId: string | null;
}

const LOCAL = "local";

/**
 * Refresh every docker list for one daemon plus its disk-usage summary —
 * prunes and removals change several of them at once.
 */
export function invalidateDockerQueries(
	queryClient: QueryClient,
	trpc: ReturnType<typeof useTRPC>,
	serverId: string | null,
) {
	const input = { serverId };
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.docker.containers.queryKey(input) }),
		queryClient.invalidateQueries({ queryKey: trpc.docker.images.queryKey(input) }),
		queryClient.invalidateQueries({ queryKey: trpc.docker.networks.queryKey(input) }),
		queryClient.invalidateQueries({ queryKey: trpc.docker.volumes.queryKey(input) }),
		queryClient.invalidateQueries({ queryKey: trpc.docker.systemInfo.queryKey(input) }),
	]);
}

/** Docker control center: full control over the daemon from the dashboard. */
export function DockerView() {
	const trpc = useTRPC();
	const { can, isInstanceAdmin, isLoading: capabilitiesLoading } = useCapabilities();
	const { data: activeOrganization } = authClient.useActiveOrganization();
	const activeOrganizationId = activeOrganization?.id ?? null;
	// undefined = nothing picked yet → fall back to the first daemon the caller may use.
	const [serverId, setServerId] = useState<string | null | undefined>(undefined);
	const serversQuery = useQuery(trpc.server.all.queryOptions());
	const servers = serversQuery.data ?? [];

	// The session role only exists client-side; keep SSR and the first client
	// paint identical by rendering the skeleton until mounted.
	const mounted = useMounted();

	// A server picked in one organization does not exist in the next one —
	// forget it when the active org changes (state adjusted during render, per
	// React's guidance) or when the id vanishes from the list.
	const [seenOrganizationId, setSeenOrganizationId] = useState(activeOrganizationId);
	if (seenOrganizationId !== activeOrganizationId) {
		setSeenOrganizationId(activeOrganizationId);
		setServerId(undefined);
	}
	useEffect(() => {
		if (!serverId || !serversQuery.isSuccess) return;
		if (!servers.some((server) => server.serverId === serverId)) {
			setServerId(undefined);
		}
	}, [serverId, servers, serversQuery.isSuccess]);

	const canManage = can("docker.manage");
	const firstServerId = servers[0]?.serverId ?? null;
	// Non-instance admins are rejected for the local socket, so their default
	// is the first managed server rather than "This server".
	const effectiveServerId: string | null =
		serverId !== undefined ? serverId : isInstanceAdmin ? null : firstServerId;

	const selector = (
		<Select
			value={effectiveServerId ?? LOCAL}
			onValueChange={(value) => setServerId(value === LOCAL ? null : value)}
		>
			<SelectTrigger className="w-52">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{isInstanceAdmin && <SelectItem value={LOCAL}>This server</SelectItem>}
				{servers.map((server) => (
					<SelectItem key={server.serverId} value={server.serverId}>
						{server.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);

	let body: React.ReactNode;
	if (!mounted || capabilitiesLoading || (serversQuery.isPending && !isInstanceAdmin)) {
		body = <Skeleton className="h-64 w-full" />;
	} else if (!canManage) {
		body = (
			<PermissionState
				title="Docker control center is restricted"
				description={`You need the "${capabilityLabel("docker.manage")}" permission in this organization. Ask an organization admin to grant it.`}
			/>
		);
	} else if (!isInstanceAdmin && effectiveServerId === null) {
		body = (
			<PermissionState
				title="No managed server to inspect"
				description="Docker on the Nixploy host is only available to the instance admin. Add a remote server to manage its daemon from here."
				action={
					<Button asChild variant="outline" size="sm">
						<Link href="/dashboard/settings/servers">Go to Servers</Link>
					</Button>
				}
			/>
		);
	} else {
		body = (
			<Tabs defaultValue="containers">
				<TabsList variant="line" className="w-full justify-start overflow-x-auto border-b">
					<TabsTrigger value="containers">Containers</TabsTrigger>
					<TabsTrigger value="images">Images</TabsTrigger>
					{/* Nodes/services are cluster-wide: docker.nodes and swarmServices
					    reject everyone but the instance admin, even with a serverId. */}
					{isInstanceAdmin && <TabsTrigger value="swarm">Swarm</TabsTrigger>}
					<TabsTrigger value="networks">Networks</TabsTrigger>
					<TabsTrigger value="volumes">Volumes</TabsTrigger>
					<TabsTrigger value="system">System</TabsTrigger>
				</TabsList>
				<TabsContent value="containers">
					<ContainersTab serverId={effectiveServerId} />
				</TabsContent>
				<TabsContent value="images">
					<ImagesTab serverId={effectiveServerId} />
				</TabsContent>
				{isInstanceAdmin && (
					<TabsContent value="swarm">
						<SwarmTab serverId={effectiveServerId} />
					</TabsContent>
				)}
				<TabsContent value="networks">
					<NetworksTab serverId={effectiveServerId} />
				</TabsContent>
				<TabsContent value="volumes">
					<VolumesTab serverId={effectiveServerId} />
				</TabsContent>
				<TabsContent value="system">
					<SystemTab serverId={effectiveServerId} />
				</TabsContent>
			</Tabs>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Docker"
				description="Containers, images, swarm and system — full control of the daemon."
				actions={mounted && canManage ? selector : null}
			/>
			{body}
		</div>
	);
}

function PermissionState({
	title,
	description,
	action,
}: {
	title: string;
	description: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
			<ShieldAlert className="size-6 text-muted-foreground" />
			<p className="text-sm font-medium">{title}</p>
			<p className="max-w-md text-xs text-muted-foreground">{description}</p>
			{action ? <div className="mt-2">{action}</div> : null}
		</div>
	);
}

export function DockerError({ error }: { error: unknown }) {
	return (
		<div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center">
			<Container className="size-6 text-muted-foreground" />
			<p className="text-sm font-medium">Docker is not reachable</p>
			<p className="max-w-md text-xs text-muted-foreground">
				{error instanceof Error ? error.message : "Failed to query the docker daemon."}
			</p>
		</div>
	);
}
