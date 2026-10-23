"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { LoadError } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { DangerZone } from "@/components/services/danger-zone";
import { DomainManager } from "@/components/services/domain-manager";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

/**
 * One external upstream: the origin Traefik fronts, its domains, and the
 * delete. No tabs — an upstream has no deploy, runtime or environment, so
 * the service page chrome would be a row of empty tabs.
 */
export function UpstreamDetail({
	projectId,
	externalUpstreamId,
}: {
	projectId: string;
	externalUpstreamId: string;
}) {
	const trpc = useTRPC();
	const router = useRouter();
	const { can } = useCapabilities();
	const canManage = can("domains.manage");
	const manageHint = canManage ? undefined : capabilityHint("domains.manage");

	const upstreamQuery = useQuery(trpc.upstream.one.queryOptions({ externalUpstreamId }));
	const upstream = upstreamQuery.data;

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [targetUrl, setTargetUrl] = useState("");
	const [passHostHeader, setPassHostHeader] = useState(true);
	const [insecureSkipVerify, setInsecureSkipVerify] = useState(false);

	// Seed the form from the row once it is loaded (and again after a save).
	useEffect(() => {
		if (!upstream) return;
		setName(upstream.name);
		setDescription(upstream.description ?? "");
		setTargetUrl(upstream.targetUrl);
		setPassHostHeader(upstream.passHostHeader);
		setInsecureSkipVerify(upstream.insecureSkipVerify);
	}, [upstream]);

	const invalidate = [
		trpc.upstream.one.queryKey({ externalUpstreamId }),
		...(upstream
			? [trpc.upstream.all.queryKey({ environmentId: upstream.environment.environmentId })]
			: []),
	];
	const save = useSaveMutation(trpc.upstream.update.mutationOptions(), {
		successMessage: "External upstream updated",
		invalidate,
	});
	const resync = useSaveMutation(trpc.upstream.resync.mutationOptions(), {
		successMessage: "Route re-checked",
		invalidate,
	});
	const remove = useSaveMutation(trpc.upstream.delete.mutationOptions(), {
		successMessage: "External upstream deleted",
		invalidate: upstream
			? [trpc.upstream.all.queryKey({ environmentId: upstream.environment.environmentId })]
			: [],
		onSuccess: () =>
			router.push(
				`/dashboard/projects/${projectId}?env=${encodeURIComponent(upstream?.environment.name ?? "")}`,
			),
	});

	if (upstreamQuery.isPending) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-40 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}
	if (upstreamQuery.isError || !upstream) {
		return (
			<LoadError
				title="External upstream not found"
				message="It may have been deleted, or it belongs to a project you cannot see."
				onRetry={() => upstreamQuery.refetch()}
			/>
		);
	}

	const dirty =
		name.trim() !== upstream.name ||
		description.trim() !== (upstream.description ?? "") ||
		targetUrl.trim() !== upstream.targetUrl ||
		passHostHeader !== upstream.passHostHeader ||
		insecureSkipVerify !== upstream.insecureSkipVerify;

	const submit = () => {
		if (!name.trim() || !targetUrl.trim()) return;
		save.mutate({
			externalUpstreamId,
			name: name.trim(),
			description: description.trim() || null,
			...(targetUrl.trim() !== upstream.targetUrl ? { targetUrl: targetUrl.trim() } : {}),
			passHostHeader,
			insecureSkipVerify,
		});
	};

	const projectHref = `/dashboard/projects/${projectId}?env=${encodeURIComponent(upstream.environment.name)}`;

	return (
		<div className="space-y-6">
			<PageHeader
				title={upstream.name}
				description={
					<span className="font-mono text-xs">
						{upstream.appName} → {upstream.targetUrl}
					</span>
				}
				breadcrumb={
					<span className="flex flex-wrap items-center gap-1">
						<Link href="/dashboard/projects" className="hover:text-foreground">
							Projects
						</Link>
						<span>/</span>
						<Link href={projectHref} className="hover:text-foreground">
							{upstream.environment.project.name}
						</Link>
						<span>/</span>
						<span>{upstream.environment.name}</span>
						<span>/</span>
						<span className="text-foreground">External upstream</span>
					</span>
				}
			/>

			{upstream.blockedReason ? (
				<div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-start gap-2">
						<AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
						<div>
							<p className="font-medium text-destructive">Route withheld</p>
							<p className="text-muted-foreground">
								The hourly check found the target no longer passes the egress policy:{" "}
								{upstream.blockedReason}. Fix the record or the target and re-check.
							</p>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						disabled={!canManage || resync.isPending}
						title={manageHint}
						onClick={() => resync.mutate({ externalUpstreamId })}
					>
						{resync.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<RefreshCw className="size-4" />
						)}
						Re-check now
					</Button>
				</div>
			) : null}

			<SettingsStack>
				<SettingsSection
					title="Target"
					description="The origin Traefik forwards to. Domains attached below get certificates, middlewares and uptime probes exactly as a service would."
					actions={
						<Button
							size="sm"
							disabled={!canManage || !dirty || save.isPending}
							title={manageHint}
							onClick={submit}
						>
							{save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
							Save
						</Button>
					}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="upstream-name">Name</Label>
							<Input
								id="upstream-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								disabled={!canManage}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="upstream-url">Target URL</Label>
							<Input
								id="upstream-url"
								value={targetUrl}
								onChange={(event) => setTargetUrl(event.target.value)}
								placeholder="https://old-host.example.com"
								autoComplete="off"
								disabled={!canManage}
							/>
							<p className="text-xs text-muted-foreground">
								An origin only — put path rewrites on the domain. Cluster-internal targets are
								refused; LAN targets need private egress. <HelpLink slug="domains" />
							</p>
						</div>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="upstream-description">Description</Label>
						<Textarea
							id="upstream-description"
							rows={2}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							disabled={!canManage}
						/>
					</div>
					<div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
						<div>
							<Label htmlFor="upstream-pass-host">Pass the public Host header</Label>
							<p className="text-xs text-muted-foreground">
								Off sends the target's own hostname instead — what a SaaS origin expects.
							</p>
						</div>
						<Switch
							id="upstream-pass-host"
							checked={passHostHeader}
							onCheckedChange={setPassHostHeader}
							disabled={!canManage}
						/>
					</div>
					<div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
						<div>
							<Label htmlFor="upstream-insecure">Skip TLS verification of the target</Label>
							<p className="text-xs text-muted-foreground">
								Only for a self-signed https origin. Traefik still terminates the public side with a
								real certificate.
							</p>
						</div>
						<Switch
							id="upstream-insecure"
							checked={insecureSkipVerify}
							onCheckedChange={setInsecureSkipVerify}
							disabled={!canManage}
						/>
					</div>
				</SettingsSection>

				<DomainManager serviceType="external" serviceId={externalUpstreamId} />

				<DangerZone
					title="Delete external upstream"
					description="Removes the Traefik route and every domain and uptime probe attached to it. The target itself is untouched."
					actionLabel="Delete upstream"
					requireText={upstream.name}
					disabled={!canManage}
					disabledReason={manageHint}
					onConfirm={() => remove.mutateAsync({ externalUpstreamId })}
				/>
			</SettingsStack>
		</div>
	);
}
