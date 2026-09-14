"use client";

import { useQuery } from "@tanstack/react-query";
import { Info, Loader2, type LucideIcon, MoreVertical, ScrollText } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { ServiceUrlBar } from "@/components/services/service-url";
import { DeploymentStatusBadge, ServiceStatusBadge } from "@/components/services/status-badge";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/ui/date-time";
import { DisabledHint } from "@/components/ui/disabled-hint";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { describeTriggeredBy } from "@/hooks/use-running-deployments";
import { useTRPC } from "@/lib/trpc";

/**
 * One lifecycle button (Deploy / Redeploy / Start / Stop / Reload). `primary`
 * actions stay visible at every width; the rest collapse into the overflow
 * menu below `sm`.
 */
export interface ServiceAction {
	key: string;
	label: string;
	icon: LucideIcon;
	onClick: () => void;
	pending?: boolean;
	disabled?: boolean;
	/** Tooltip shown on the disabled control (capability or readiness reason). */
	hint?: string;
	variant?: "default" | "outline";
	primary?: boolean;
}

export type ServiceActions = ServiceAction[];

/** Deployment currently queued or running for this service, if any. */
export interface ServiceInFlight {
	status: string;
	queuePosition?: number | null;
}

/**
 * Breadcrumb `Projects / <project> / <environment> / <service>` for a service
 * page. Names the caller already has are used as-is; the rest are resolved
 * from the cached project/environment queries (database rows carry only
 * `environmentId`).
 */
function useServiceBreadcrumb({
	projectId,
	environmentId,
	projectName,
	environmentName,
}: {
	projectId: string;
	environmentId?: string | null;
	projectName?: string | null;
	environmentName?: string | null;
}) {
	const trpc = useTRPC();
	const projectQuery = useQuery({
		...trpc.project.one.queryOptions({ projectId }),
		enabled: !projectName,
	});
	const environmentsQuery = useQuery({
		...trpc.environment.byProject.queryOptions({ projectId }),
		enabled: !environmentName && Boolean(environmentId),
	});
	const resolvedEnvironment =
		environmentName ??
		(environmentsQuery.data ?? []).find((row) => row.environmentId === environmentId)?.name ??
		null;
	return {
		project: projectName ?? projectQuery.data?.name ?? null,
		environment: resolvedEnvironment,
	};
}

function ActionButton({ action }: { action: ServiceAction }) {
	const Icon = action.icon;
	return (
		<DisabledHint
			hint={action.hint}
			className={action.primary ? undefined : "hidden sm:inline-flex"}
		>
			<Button
				variant={action.variant ?? (action.primary ? "default" : "outline")}
				disabled={action.disabled}
				onClick={action.onClick}
			>
				{action.pending ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
				{action.label}
			</Button>
		</DisabledHint>
	);
}

/**
 * Shared header for every service page — application, compose and the five
 * databases (UX audit F10). One breadcrumb shape, one status badge, one
 * action cluster fed by `actions`, plus the readiness-disabled Deploy hint
 * and the last-error line (UX audit F2).
 */
export function ServicePageHeader({
	projectId,
	projectName,
	environmentId,
	environmentName,
	name,
	subtitle,
	status,
	inFlight,
	actions,
	lastError,
	lastDeploy,
	notice,
	onViewLogs,
	before,
	domainsFor,
}: {
	projectId: string;
	projectName?: string | null;
	environmentId?: string | null;
	environmentName?: string | null;
	name: string;
	/** Second description line — kind, appName or the user's description. */
	subtitle?: ReactNode;
	status: "idle" | "running" | "done" | "error" | null | undefined;
	inFlight?: ServiceInFlight | null;
	actions?: ServiceActions;
	/** First line of the last failed deployment's error, if the last one failed. */
	lastError?: string | null;
	/**
	 * The last deployment that succeeded. "Running" answers whether it is up;
	 * this answers since when and because of whom, which is the other half of
	 * the question an operator opens a service page with.
	 */
	lastDeploy?: {
		finishedAt: Date | string | null;
		triggeredBy?: string | null;
		triggeredByName?: string | null;
	} | null;
	/**
	 * Why the service cannot be deployed yet ("Set a repository URL or Docker
	 * image first"). It also sits on the disabled Deploy button as a tooltip,
	 * which a first-time operator never hovers — so it is said out loud here.
	 */
	notice?: string | null;
	/** Opens that deployment's log drawer (Deploy tab). */
	onViewLogs?: () => void;
	/** Slot rendered before the action cluster (Deploy Copilot). */
	before?: ReactNode;
	/**
	 * Service whose domains become the address line under the title. Databases
	 * pass nothing; applications and compose stacks pass their id, which hits
	 * the same cached `domain.all` query the Domains tab uses.
	 */
	domainsFor?: { applicationId?: string; composeId?: string };
}) {
	const trpc = useTRPC();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const crumbs = useServiceBreadcrumb({
		projectId,
		environmentId,
		projectName,
		environmentName,
	});
	const domainsQuery = useQuery({
		...trpc.domain.all.queryOptions(domainsFor ?? {}),
		enabled: Boolean(domainsFor?.applicationId ?? domainsFor?.composeId),
	});
	const showDomainsTab = () => {
		const next = new URLSearchParams(searchParams.toString());
		next.set("tab", "domains");
		router.replace(`${pathname}?${next.toString()}`, { scroll: false });
	};
	const list = actions ?? [];
	const overflow = list.filter((action) => !action.primary);
	const anyPending = list.some((action) => action.pending);

	return (
		<PageHeader
			breadcrumb={
				<nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5">
					<Link href="/dashboard" className="transition-colors hover:text-foreground">
						Projects
					</Link>
					<span aria-hidden>/</span>
					<Link
						href={`/dashboard/projects/${projectId}`}
						className="transition-colors hover:text-foreground"
					>
						{crumbs.project ?? "Project"}
					</Link>
					{crumbs.environment ? (
						<>
							<span aria-hidden>/</span>
							<Link
								href={`/dashboard/projects/${projectId}?env=${encodeURIComponent(crumbs.environment)}`}
								className="transition-colors hover:text-foreground"
							>
								{crumbs.environment}
							</Link>
						</>
					) : null}
					<span aria-hidden>/</span>
					<span className="text-foreground">{name}</span>
				</nav>
			}
			title={
				<span className="flex items-center gap-2.5">
					<span className="truncate">{name}</span>
					{inFlight ? (
						<DeploymentStatusBadge
							status={inFlight.status as "queued" | "running"}
							queuePosition={inFlight.queuePosition}
						/>
					) : (
						<ServiceStatusBadge status={status} />
					)}
				</span>
			}
			description={
				<span className="flex flex-col gap-1">
					{subtitle ? <span className="truncate">{subtitle}</span> : null}
					{(domainsQuery.data?.length ?? 0) > 0 ? (
						<ServiceUrlBar domains={domainsQuery.data ?? []} onShowAll={showDomainsTab} />
					) : null}
					{lastDeploy?.finishedAt && !lastError ? (
						<span className="flex items-center gap-1.5">
							Deployed <DateTime value={lastDeploy.finishedAt} />
							{describeTriggeredBy(lastDeploy) ? ` ${describeTriggeredBy(lastDeploy)}` : null}
						</span>
					) : null}
					{notice && !lastError ? (
						<span className="flex items-center gap-1.5">
							<Info className="size-3.5 shrink-0" />
							<span className="truncate">{notice}</span>
						</span>
					) : null}
					{lastError ? (
						<span className="flex items-center gap-1.5 text-destructive">
							<span className="truncate">Last deployment failed: {lastError}</span>
							{onViewLogs ? (
								<button
									type="button"
									className="inline-flex shrink-0 items-center gap-1 underline-offset-2 hover:underline"
									onClick={onViewLogs}
								>
									<ScrollText className="size-3.5" />
									View logs
								</button>
							) : null}
						</span>
					) : null}
				</span>
			}
			actions={
				list.length > 0 || before ? (
					<>
						{before}
						{list.map((action) => (
							<ActionButton key={action.key} action={action} />
						))}
						{overflow.length > 0 ? (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="outline"
										size="icon"
										className="sm:hidden"
										aria-label="More actions"
										disabled={anyPending}
									>
										<MoreVertical className="size-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{overflow.map((action) => (
										<DropdownMenuItem
											key={action.key}
											disabled={action.disabled}
											title={action.hint}
											onClick={action.onClick}
										>
											<action.icon className="size-4" />
											{action.label}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</>
				) : null
			}
		/>
	);
}
