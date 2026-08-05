"use client";

import { useQuery } from "@tanstack/react-query";
import { Container } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/shell";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/** Docker control center: full control over the daemon from the dashboard. */
export function DockerView() {
	const trpc = useTRPC();
	const [serverId, setServerId] = useState<string | null>(null);
	const serversQuery = useQuery(trpc.server.all.queryOptions());

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Docker"
				description="Containers, images, swarm and system — full control of the daemon."
				actions={
					<Select
						value={serverId ?? "local"}
						onValueChange={(value) => setServerId(value === "local" ? null : value)}
					>
						<SelectTrigger className="w-52">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="local">This server</SelectItem>
							{(serversQuery.data ?? []).map((server) => (
								<SelectItem key={server.serverId} value={server.serverId}>
									{server.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				}
			/>

			<Tabs defaultValue="containers">
				<TabsList variant="line" className="w-full justify-start overflow-x-auto border-b">
					<TabsTrigger value="containers">Containers</TabsTrigger>
					<TabsTrigger value="images">Images</TabsTrigger>
					<TabsTrigger value="swarm">Swarm</TabsTrigger>
					<TabsTrigger value="networks">Networks</TabsTrigger>
					<TabsTrigger value="volumes">Volumes</TabsTrigger>
					<TabsTrigger value="system">System</TabsTrigger>
				</TabsList>
				<TabsContent value="containers">
					<ContainersTab serverId={serverId} />
				</TabsContent>
				<TabsContent value="images">
					<ImagesTab serverId={serverId} />
				</TabsContent>
				<TabsContent value="swarm">
					<SwarmTab serverId={serverId} />
				</TabsContent>
				<TabsContent value="networks">
					<NetworksTab serverId={serverId} />
				</TabsContent>
				<TabsContent value="volumes">
					<VolumesTab serverId={serverId} />
				</TabsContent>
				<TabsContent value="system">
					<SystemTab serverId={serverId} />
				</TabsContent>
			</Tabs>
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
