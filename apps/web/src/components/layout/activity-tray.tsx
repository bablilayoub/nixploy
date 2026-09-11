"use client";

import { ChevronDown, Loader2, Rocket, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { DeploymentStatusBadge } from "@/components/services/status-badge";
import { Button } from "@/components/ui/button";
import { useRunningDeployments } from "@/hooks/use-running-deployments";
import { cn } from "@/lib/utils";

export type ActivityKind = "backup" | "restore" | "verify" | "clone" | "template";

export interface ActivityItem {
	id: string;
	kind: ActivityKind;
	/** One line: "Backup demo-pg", "Restore demo-pg". */
	label: string;
	/** Optional second line — destination, key, target environment. */
	detail?: string;
	/** Where "View" goes (the tab that shows the run). */
	href?: string;
	status: "running" | "done" | "error";
	startedAt: number;
}

/**
 * Long operations started in this tab (UX audit F14). Deployments come from
 * the shared running-deployments query; everything else (backups, restores,
 * verifies, environment clones) has no org-wide "what is running" procedure,
 * so the pages that start them register here — see the handoff note.
 *
 * Module level, like the running-deployments cache: the tray lives in the
 * layout and the producers are scattered across pages.
 */
let activities: ActivityItem[] = [];
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

const getSnapshot = () => activities;
const getServerSnapshot = () => activities;

/** Register (or replace) one long operation. Returns its id. */
export function trackActivity(
	item: Omit<ActivityItem, "startedAt" | "status"> & { status?: ActivityItem["status"] },
): string {
	const next: ActivityItem = {
		status: "running",
		startedAt: Date.now(),
		...item,
	};
	activities = [next, ...activities.filter((row) => row.id !== item.id)];
	emit();
	return next.id;
}

/** Mark one operation finished; it fades out of the tray shortly after. */
export function settleActivity(id: string, status: "done" | "error", detail?: string) {
	activities = activities.map((row) =>
		row.id === id ? { ...row, status, detail: detail ?? row.detail } : row,
	);
	emit();
	window.setTimeout(() => {
		activities = activities.filter((row) => row.id !== id);
		emit();
	}, 8_000);
}

export function clearActivity(id: string) {
	activities = activities.filter((row) => row.id !== id);
	emit();
}

/**
 * Declarative form: show `item` in the tray for as long as `active` is true
 * (a pending mutation). Use `trackActivity` directly for fire-and-forget
 * operations the server only acknowledges ("Restore started").
 */
export function useTrackedActivity(
	item: Omit<ActivityItem, "startedAt" | "status"> & { active: boolean },
) {
	const { active, id } = item;
	const latest = useRef(item);
	latest.current = item;
	useEffect(() => {
		if (!active) return;
		const { active: _ignored, ...rest } = latest.current;
		trackActivity(rest);
		return () => clearActivity(id);
	}, [active, id]);
}

function useActivities(): ActivityItem[] {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const KIND_LABEL: Record<ActivityKind, string> = {
	backup: "Backup",
	restore: "Restore",
	verify: "Verify",
	clone: "Clone",
	template: "Template",
};

function Row({
	title,
	detail,
	href,
	badge,
	onDismiss,
}: {
	title: string;
	detail?: string;
	href?: string;
	badge: React.ReactNode;
	onDismiss?: () => void;
}) {
	return (
		<li className="flex items-start gap-2 px-3 py-2">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{title}</p>
				{detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{badge}
				{href ? (
					<Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
						<Link href={href}>View</Link>
					</Button>
				) : null}
				{onDismiss ? (
					<Button
						size="icon"
						variant="ghost"
						className="size-6"
						aria-label="Dismiss"
						onClick={onDismiss}
					>
						<X className="size-3.5" />
					</Button>
				) : null}
			</div>
		</li>
	);
}

/**
 * Bottom-right activity tray (UX audit F14): a collapsed pill with a count
 * that expands into the list of everything running right now — deployments,
 * backups, restores, verifies, clones — each linking to the tab that shows
 * its progress. Renders nothing when nothing is in flight.
 */
export function ActivityTray() {
	const [expanded, setExpanded] = useState(false);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const { active } = useRunningDeployments();
	const items = useActivities();

	const deployments = useMemo(
		() =>
			active.map((row) => {
				const serviceType = row.service.type;
				const serviceId = serviceType === "application" ? row.applicationId : row.composeId;
				return {
					id: row.deploymentId,
					name: row.service.name ?? row.service.appName ?? "Service",
					project: row.project.name,
					status: row.status,
					queuePosition: row.queuePosition,
					href: serviceId
						? `/dashboard/projects/${row.project.projectId}/services/${serviceType}/${serviceId}?tab=deployments&deployment=${row.deploymentId}`
						: undefined,
				};
			}),
		[active],
	);

	const total = deployments.length + items.length;
	const running = deployments.length + items.filter((item) => item.status === "running").length;
	const visible = mounted && total > 0;

	// Sonner also renders bottom-right; globals.css lifts the toast stack while
	// the tray is on screen so a toast never covers the pill.
	useEffect(() => {
		if (!visible) return;
		document.body.dataset.activityTray = "1";
		return () => {
			delete document.body.dataset.activityTray;
		};
	}, [visible]);

	if (!visible) return null;

	return (
		<div
			data-slot="activity-tray"
			className="fixed bottom-4 end-4 z-40 w-[min(22rem,calc(100vw-2rem))]"
		>
			{expanded ? (
				<div className="overflow-hidden rounded-lg border bg-popover shadow-lg">
					<div className="flex items-center justify-between gap-2 border-b px-3 py-2">
						<p className="text-sm font-medium">
							Activity
							<span className="ms-1.5 text-xs font-normal text-muted-foreground">
								{running} running
							</span>
						</p>
						<Button
							size="icon"
							variant="ghost"
							className="size-6"
							aria-label="Collapse activity"
							onClick={() => setExpanded(false)}
						>
							<ChevronDown className="size-4" />
						</Button>
					</div>
					<ul className="max-h-72 divide-y overflow-y-auto">
						{deployments.map((row) => (
							<Row
								key={row.id}
								title={row.name}
								detail={row.project}
								href={row.href}
								badge={
									<DeploymentStatusBadge
										status={row.status as "queued" | "running"}
										queuePosition={row.queuePosition}
									/>
								}
							/>
						))}
						{items.map((item) => (
							<Row
								key={item.id}
								title={item.label}
								detail={item.detail ?? KIND_LABEL[item.kind]}
								href={item.href}
								onDismiss={item.status === "running" ? undefined : () => clearActivity(item.id)}
								badge={
									item.status === "running" ? (
										<Loader2 className="size-3.5 animate-spin text-muted-foreground" />
									) : (
										<span
											className={cn(
												"text-xs",
												item.status === "error" ? "text-destructive" : "text-muted-foreground",
											)}
										>
											{item.status === "error" ? "Failed" : "Done"}
										</span>
									)
								}
							/>
						))}
					</ul>
				</div>
			) : (
				<Button
					variant="outline"
					className="ms-auto flex shadow-lg"
					onClick={() => setExpanded(true)}
				>
					{running > 0 ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Rocket className="size-4" />
					)}
					{running > 0 ? `${running} running` : `Activity (${total})`}
				</Button>
			)}
		</div>
	);
}
