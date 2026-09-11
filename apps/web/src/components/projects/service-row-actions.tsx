"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Copy, Loader2, MoreHorizontal, Tag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { capabilityHint } from "@/components/services/capability-hint";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC, useTRPCClient } from "@/lib/trpc";
import { ServiceTagsDialog } from "./service-tags-dialog";
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

/** Per-service row menu on the project page: duplicate, tags and move. */
export function ServiceRowActions({
	service,
	projectId,
	environmentName,
	currentEnvironmentId,
}: {
	service: ServiceEntry;
	projectId: string;
	environmentName: string;
	currentEnvironmentId?: string;
}) {
	const trpc = useTRPC();
	const trpcClient = useTRPCClient();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const [moveOpen, setMoveOpen] = useState(false);
	const [tagsOpen, setTagsOpen] = useState(false);
	const [targetEnvironmentId, setTargetEnvironmentId] = useState("");

	// Duplicate copies env/credentials → service.write + secrets.write; move → service.write.
	const canDuplicate = can("service.write") && can("secrets.write");
	const canMove = can("service.write");
	const canTag = can("tags.manage");

	const projectsQuery = useQuery({
		...trpc.project.all.queryOptions(),
		enabled: moveOpen,
	});

	/**
	 * Duplicate/move only touch this service type's list. Move can land in any
	 * project/environment, so the `<type>.all` path key (all inputs) plus the
	 * environment counts of every project are refreshed — never the whole cache.
	 */
	const invalidateServices = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: trpc[service.type].all.pathKey(),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.environment.byProject.pathKey(),
			}),
			queryClient.invalidateQueries({ queryKey: trpc.project.all.queryKey() }),
			queryClient.invalidateQueries({
				queryKey: trpc.project.one.queryKey({ projectId }),
			}),
		]);
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
		onError: (error) => toastError(error),
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
		onError: (error) => toastError(error),
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
						aria-label={`Actions for ${service.name} in ${environmentName}`}
						className="relative z-10"
					>
						<MoreHorizontal className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						disabled={duplicate.isPending || !canDuplicate}
						title={canDuplicate ? undefined : capabilityHint("service.write", "secrets.write")}
						onClick={() => duplicate.mutate()}
					>
						<Copy className="size-4" />
						Duplicate
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!canTag}
						title={canTag ? undefined : capabilityHint("tags.manage")}
						onClick={() => setTagsOpen(true)}
					>
						<Tag className="size-4" />
						Tags…
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!canMove}
						title={canMove ? undefined : capabilityHint("service.write")}
						onClick={() => setMoveOpen(true)}
					>
						<ArrowRightLeft className="size-4" />
						Move to environment…
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<ServiceTagsDialog service={service} open={tagsOpen} onOpenChange={setTagsOpen} />

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
