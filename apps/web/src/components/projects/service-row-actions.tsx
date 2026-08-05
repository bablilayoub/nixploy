"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Copy, Loader2, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useTRPC, useTRPCClient } from "@/lib/trpc";
import type { ServiceType } from "./service-types";
import type { ServiceEntry } from "./services-table";

const ID_FIELD: Record<ServiceType, string> = {
	application: "applicationId",
	compose: "composeId",
	postgres: "postgresId",
	mysql: "mysqlId",
	mariadb: "mariadbId",
	mongo: "mongoId",
	redis: "redisId",
};

/** Per-service row menu on the project page: duplicate and move. */
export function ServiceRowActions({
	service,
	currentEnvironmentId,
}: {
	service: ServiceEntry;
	currentEnvironmentId?: string;
}) {
	const trpc = useTRPC();
	const trpcClient = useTRPCClient();
	const queryClient = useQueryClient();
	const [moveOpen, setMoveOpen] = useState(false);
	const [targetEnvironmentId, setTargetEnvironmentId] = useState("");

	const projectsQuery = useQuery({
		...trpc.project.all.queryOptions(),
		enabled: moveOpen,
	});

	const invalidateServices = async () => {
		// Rare action: a full invalidation refreshes every service list and
		// the environment counts in one pass.
		await queryClient.invalidateQueries();
	};

	const duplicate = useMutation({
		mutationFn: async () => {
			const payload = { [ID_FIELD[service.type]]: service.id };
			// biome-ignore lint/suspicious/noExplicitAny: dynamic router access by service type; every service router exposes duplicate
			return await (trpcClient as any)[service.type].duplicate.mutate(payload);
		},
		onSuccess: async () => {
			toast.success(`${service.name} duplicated`);
			await invalidateServices();
		},
		onError: (error) => toast.error(error.message),
	});

	const move = useMutation({
		mutationFn: async () => {
			const payload = {
				[ID_FIELD[service.type]]: service.id,
				environmentId: targetEnvironmentId,
			};
			// biome-ignore lint/suspicious/noExplicitAny: dynamic router access by service type; every service router exposes move
			return await (trpcClient as any)[service.type].move.mutate(payload);
		},
		onSuccess: async () => {
			toast.success(`${service.name} moved`);
			setMoveOpen(false);
			await invalidateServices();
		},
		onError: (error) => toast.error(error.message),
	});

	const environmentOptions = (projectsQuery.data ?? []).flatMap((project) =>
		project.environments.map((environment) => ({
			id: environment.environmentId,
			label: `${project.name} / ${environment.name}`,
			current: environment.environmentId === currentEnvironmentId,
		})),
	);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Actions for ${service.name}`}
						className="relative z-10"
					>
						<MoreHorizontal className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem disabled={duplicate.isPending} onClick={() => duplicate.mutate()}>
						<Copy className="size-4" />
						Duplicate
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setMoveOpen(true)}>
						<ArrowRightLeft className="size-4" />
						Move to environment…
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={moveOpen} onOpenChange={setMoveOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Move {service.name}</DialogTitle>
						<DialogDescription>
							Move this service to another environment, in any project of the organization.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<Label>Target environment</Label>
						<Select value={targetEnvironmentId} onValueChange={setTargetEnvironmentId}>
							<SelectTrigger>
								<SelectValue placeholder="Select an environment" />
							</SelectTrigger>
							<SelectContent>
								{environmentOptions.map((option) => (
									<SelectItem key={option.id} value={option.id} disabled={option.current}>
										{option.label}
										{option.current ? " (current)" : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<DialogFooter>
						<Button disabled={!targetEnvironmentId || move.isPending} onClick={() => move.mutate()}>
							{move.isPending && <Loader2 className="size-4 animate-spin" />}
							Move
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
