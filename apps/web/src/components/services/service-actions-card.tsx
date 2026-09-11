"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Copy, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { capabilityHint } from "@/components/services/capability-hint";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
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
import { useTRPC } from "@/lib/trpc";

export type ServiceActionsKind =
	| "application"
	| "compose"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis";

/** Detail page route for a service kind (`services/<segment>/<id>`). */
const ROUTE_SEGMENT: Record<ServiceActionsKind, string> = {
	application: "application",
	compose: "compose",
	postgres: "postgres",
	mysql: "mysql",
	mariadb: "mariadb",
	mongo: "mongo",
	redis: "redis",
};

/**
 * "Duplicate" and "Move to environment" for a service (application, compose
 * or database). The mutations live on each router (`<kind>.duplicate` /
 * `<kind>.move`); the card only owns the dialogs, the environment picker and
 * the navigation to the new row.
 */
export function ServiceActionsCard({
	kind,
	serviceName,
	projectId,
	environmentId,
	onDuplicate,
	onRename,
	onMove,
}: {
	kind: ServiceActionsKind;
	serviceName: string;
	projectId: string;
	/** Environment the service currently lives in. */
	environmentId: string;
	/** Run `<kind>.duplicate`; resolve with the new service id. */
	onDuplicate: (targetEnvironmentId: string) => Promise<string>;
	/**
	 * Rename the duplicate when the user picked a different name (the duplicate
	 * procedures copy the source name). Optional: skipped when absent.
	 */
	onRename?: (serviceId: string, name: string) => Promise<unknown>;
	/** Run `<kind>.move`. */
	onMove: (targetEnvironmentId: string) => Promise<unknown>;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	// Duplicating copies the env / credentials, so the server also requires secrets.write.
	const canDuplicate = canWrite && can("secrets.write");
	const duplicateHint = !canWrite
		? capabilityHint("service.write")
		: !canDuplicate
			? capabilityHint("secrets.write")
			: undefined;
	const moveHint = canWrite ? undefined : capabilityHint("service.write");

	const [duplicateOpen, setDuplicateOpen] = useState(false);
	const [moveOpen, setMoveOpen] = useState(false);
	const [name, setName] = useState(`${serviceName} copy`);
	const [duplicateTarget, setDuplicateTarget] = useState(environmentId);
	const [moveTarget, setMoveTarget] = useState(environmentId);
	const [pending, setPending] = useState(false);

	const environmentsQuery = useQuery({
		...trpc.environment.byProject.queryOptions({ projectId }),
		enabled: duplicateOpen || moveOpen,
	});
	const environments = environmentsQuery.data ?? [];
	const environmentName = (id: string) =>
		environments.find((environment) => environment.environmentId === id)?.name ?? id;

	const invalidateLists = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: trpc.environment.byProject.queryKey({ projectId }),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.project.one.queryKey({ projectId }),
			}),
			queryClient.invalidateQueries({ queryKey: trpc.project.all.queryKey() }),
			queryClient.invalidateQueries({
				queryKey: trpc.application.all.pathKey(),
			}),
			queryClient.invalidateQueries({ queryKey: trpc.compose.all.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.postgres.all.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.mysql.all.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.mariadb.all.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.mongo.all.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.redis.all.pathKey() }),
		]);
	};

	const openDuplicate = () => {
		setName(`${serviceName} copy`);
		setDuplicateTarget(environmentId);
		setDuplicateOpen(true);
	};

	const openMove = () => {
		setMoveTarget(environmentId);
		setMoveOpen(true);
	};

	const handleDuplicate = async () => {
		const trimmed = name.trim();
		if (!trimmed) {
			toast.error("Name is required");
			return;
		}
		setPending(true);
		try {
			const newId = await onDuplicate(duplicateTarget);
			if (onRename && trimmed !== serviceName) {
				try {
					await onRename(newId, trimmed);
				} catch (error) {
					// The copy exists; only the rename failed. Say so and still navigate.
					toast.warning(
						error instanceof Error
							? `Duplicated, but renaming failed: ${error.message}`
							: "Duplicated, but renaming failed",
					);
				}
			}
			toast.success(`Duplicated into "${environmentName(duplicateTarget)}"`);
			await invalidateLists();
			setDuplicateOpen(false);
			router.push(`/dashboard/projects/${projectId}/services/${ROUTE_SEGMENT[kind]}/${newId}`);
		} catch (error) {
			toastError(error, "Duplicate failed");
		} finally {
			setPending(false);
		}
	};

	const handleMove = async () => {
		if (moveTarget === environmentId) {
			setMoveOpen(false);
			return;
		}
		setPending(true);
		try {
			await onMove(moveTarget);
			toast.success(`Moved to "${environmentName(moveTarget)}"`);
			await invalidateLists();
			setMoveOpen(false);
		} catch (error) {
			toastError(error, "Move failed");
		} finally {
			setPending(false);
		}
	};

	const environmentPicker = (value: string, onChange: (next: string) => void, id: string) => (
		<div className="space-y-1.5">
			<Label htmlFor={id}>Target environment</Label>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger id={id} className="w-full">
					<SelectValue placeholder="Select an environment" />
				</SelectTrigger>
				<SelectContent>
					{environmentsQuery.isPending ? (
						<div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" /> Loading environments…
						</div>
					) : (
						environments.map((environment) => (
							<SelectItem key={environment.environmentId} value={environment.environmentId}>
								{environment.name}
								{environment.environmentId === environmentId ? " (current)" : ""}
							</SelectItem>
						))
					)}
				</SelectContent>
			</Select>
		</div>
	);

	return (
		<>
			<SettingsSection
				title="Duplicate or move"
				description="Copy this service (configuration, variables, mounts — not its domains, data or deployment history) or move it to another environment of this project."
				actions={
					<>
						<DisabledHint hint={duplicateHint}>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={!canDuplicate}
								onClick={openDuplicate}
							>
								<Copy className="size-4" />
								Duplicate
							</Button>
						</DisabledHint>
						<DisabledHint hint={moveHint}>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={!canWrite}
								onClick={openMove}
							>
								<ArrowRightLeft className="size-4" />
								Move to environment
							</Button>
						</DisabledHint>
					</>
				}
			/>

			<Dialog open={duplicateOpen} onOpenChange={(open) => !pending && setDuplicateOpen(open)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Duplicate service</DialogTitle>
						<DialogDescription>
							Creates a copy of <span className="font-medium">{serviceName}</span> with a new name.
							Domains, deployments and data volumes are not copied.
						</DialogDescription>
					</DialogHeader>
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void handleDuplicate();
						}}
					>
						<div className="space-y-1.5">
							<Label htmlFor="duplicate-name">Name</Label>
							<Input
								id="duplicate-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								autoComplete="off"
							/>
						</div>
						{environmentPicker(duplicateTarget, setDuplicateTarget, "duplicate-environment")}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={() => setDuplicateOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={pending || !name.trim()}>
								{pending && <Loader2 className="size-4 animate-spin" />}
								Duplicate
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={moveOpen} onOpenChange={(open) => !pending && setMoveOpen(open)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Move to environment</DialogTitle>
						<DialogDescription>
							Moves <span className="font-medium">{serviceName}</span> to another environment of
							this project. Its variables now resolve against the target environment; redeploy
							afterwards if they changed.
						</DialogDescription>
					</DialogHeader>
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void handleMove();
						}}
					>
						{environmentPicker(moveTarget, setMoveTarget, "move-environment")}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={() => setMoveOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={pending || moveTarget === environmentId}>
								{pending && <Loader2 className="size-4 animate-spin" />}
								Move
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
