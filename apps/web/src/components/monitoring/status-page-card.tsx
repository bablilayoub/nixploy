"use client";

import { useQuery } from "@tanstack/react-query";
import { Globe, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { capabilityHint } from "@/components/services/capability-hint";
import { CopyButton } from "@/components/services/copy-button";
import { useSaveBar } from "@/components/services/save-bar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

/**
 * Public status page control (product audit, Observability #4). Picks which
 * uptime probes are published at `/status/<token>` and hands over the URL.
 * Publishing makes data readable without a session, so it is gated on
 * `settings.manage` — the same bar as the rest of the organization settings.
 */
export function StatusPageCard() {
	const trpc = useTRPC();
	const { can } = useCapabilities();

	const probes = useQuery(trpc.observability.uptimeProbes.queryOptions());
	const page = useQuery(trpc.observability.statusPage.queryOptions());

	const draft = useDraft({
		probeIds: page.data?.probeIds ?? [],
		title: page.data?.title ?? "Status",
	});
	const { probeIds: selected, title } = draft.value;

	// `window.location.origin` is only known after mount; the URL block waits.
	const [origin, setOrigin] = useState<string | null>(null);
	useEffect(() => setOrigin(window.location.origin), []);

	const statusPageKey = trpc.observability.statusPage.queryKey();

	const enable = useSaveMutation(trpc.observability.enableStatusPage.mutationOptions(), {
		successMessage: "Status page published",
		invalidate: [statusPageKey],
		onSuccess: draft.markSaved,
	});
	const disable = useSaveMutation(trpc.observability.disableStatusPage.mutationOptions(), {
		successMessage: "Status page taken offline",
		invalidate: [statusPageKey],
	});
	const rotate = useSaveMutation(trpc.observability.rotateStatusPageToken.mutationOptions(), {
		successMessage: "New status page link generated",
		invalidate: [statusPageKey],
	});

	const canManage = can("settings.manage");
	const hint = canManage ? undefined : capabilityHint("settings.manage");
	const live = page.data?.enabled === true;
	const url = origin && page.data ? `${origin}/status/${page.data.token}` : null;
	const busy = enable.isPending || disable.isPending || rotate.isPending;

	const publish = () => enable.mutate({ probeIds: selected, title: title.trim() || "Status" });

	useSaveBar(draft, {
		onSave: publish,
		pending: enable.isPending,
		disabled: !canManage || busy,
	});

	const toggle = (probeId: string, checked: boolean) => {
		draft.set((current) => ({
			...current,
			probeIds: checked
				? [...current.probeIds, probeId]
				: current.probeIds.filter((id) => id !== probeId),
		}));
	};

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					<Globe className="size-4 text-muted-foreground" />
					Status page
				</span>
			}
			description="Publish selected uptime probes on an unauthenticated page: probe host, current state, 90-day uptime and recent incident titles. Nothing else leaves the organization."
		>
			{probes.isPending || page.isPending ? (
				<Skeleton className="h-24 w-full" />
			) : (
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="status-page-title">Page title</Label>
						<Input
							id="status-page-title"
							className="sm:max-w-sm"
							value={title}
							disabled={!canManage}
							onChange={(event) => draft.patch({ title: event.target.value })}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<Label>Published probes</Label>
						{(probes.data ?? []).length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No uptime probes yet. Enable one on a domain first (service → Domains).
							</p>
						) : (
							<div className="flex flex-col gap-2 rounded-md border p-3">
								{(probes.data ?? []).map((probe) => (
									<label
										key={probe.uptimeProbeId}
										className="flex items-center gap-2.5 text-sm"
										htmlFor={`probe-${probe.uptimeProbeId}`}
									>
										<Checkbox
											id={`probe-${probe.uptimeProbeId}`}
											checked={selected.includes(probe.uptimeProbeId)}
											disabled={!canManage}
											onCheckedChange={(checked) => toggle(probe.uptimeProbeId, checked === true)}
										/>
										<span className="truncate">{probe.domain?.host ?? probe.uptimeProbeId}</span>
										<span className="text-xs text-muted-foreground">{probe.status}</span>
									</label>
								))}
							</div>
						)}
					</div>

					{url && live ? (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="status-page-url">Public URL</Label>
							<div className="flex items-center gap-2">
								<Input id="status-page-url" readOnly value={url} className="font-mono text-xs" />
								<CopyButton value={url} label="Copy status page URL" />
							</div>
							<p className="text-xs text-muted-foreground">
								Anyone with this link can read the published probes. Generate a new link to revoke
								it.
							</p>
						</div>
					) : null}

					<div className="flex flex-wrap items-center justify-end gap-2">
						{page.data ? (
							<DisabledHint hint={hint}>
								<Button
									variant="outline"
									size="sm"
									disabled={!canManage || busy}
									onClick={() => rotate.mutate()}
								>
									{rotate.isPending && <Loader2 className="size-4 animate-spin" />}
									New link
								</Button>
							</DisabledHint>
						) : null}
						{live ? (
							<DisabledHint hint={hint}>
								<Button
									variant="outline"
									size="sm"
									disabled={!canManage || busy}
									onClick={() => disable.mutate()}
								>
									{disable.isPending && <Loader2 className="size-4 animate-spin" />}
									Take offline
								</Button>
							</DisabledHint>
						) : null}
						<DisabledHint hint={hint}>
							<Button size="sm" disabled={!canManage || busy} onClick={publish}>
								{enable.isPending && <Loader2 className="size-4 animate-spin" />}
								{live ? "Save" : "Publish"}
							</Button>
						</DisabledHint>
					</div>
				</div>
			)}
		</SettingsSection>
	);
}
