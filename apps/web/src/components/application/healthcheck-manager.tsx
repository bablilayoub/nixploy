"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HeartPulse, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { capabilityHint } from "@/components/services/capability-hint";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

interface HealthConfig {
	Test?: string[];
	Interval?: number;
	Timeout?: number;
	Retries?: number;
	StartPeriod?: number;
}

const SECOND = 1_000_000_000; // docker durations are nanoseconds

/** Try to recover UI fields from a stored Docker HealthConfig. */
function parseExisting(config: HealthConfig | null): {
	enabled: boolean;
	path: string;
	port: string;
	interval: string;
	timeout: string;
	retries: string;
	startPeriod: string;
} {
	const fallback = {
		enabled: false,
		path: "/",
		port: "3000",
		interval: "30",
		timeout: "5",
		retries: "3",
		startPeriod: "15",
	};
	if (!config?.Test || config.Test.length < 2) return fallback;
	const command = config.Test[config.Test.length - 1] ?? "";
	const http = command.match(/127\.0\.0\.1:(\d+)(\/[^\s"']*)?/);
	return {
		enabled: true,
		path: http?.[2] ?? "/",
		port: http?.[1] ?? "3000",
		interval: String(Math.round((config.Interval ?? 30 * SECOND) / SECOND)),
		timeout: String(Math.round((config.Timeout ?? 5 * SECOND) / SECOND)),
		retries: String(config.Retries ?? 3),
		startPeriod: String(Math.round((config.StartPeriod ?? 15 * SECOND) / SECOND)),
	};
}

/** Healthcheck config → swarm Healthcheck on the application's service. */
export function HealthcheckManager({ application }: { application: Application }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const canWrite = can("service.write");

	const existing = parseExisting(application.healthCheckSwarm as HealthConfig | null);
	const [enabled, setEnabled] = useState(existing.enabled);
	const [path, setPath] = useState(existing.path);
	const [port, setPort] = useState(existing.port);
	const [interval, setInterval] = useState(existing.interval);
	const [timeout, setTimeout] = useState(existing.timeout);
	const [retries, setRetries] = useState(existing.retries);
	const [startPeriod, setStartPeriod] = useState(existing.startPeriod);

	const save = useMutation(
		trpc.application.update.mutationOptions({
			onSuccess: () => {
				toast.success(enabled ? "Healthcheck saved" : "Healthcheck disabled");
				queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({
						applicationId: application.applicationId,
					}),
				});
			},
			onError: (error) => toastError(error),
		}),
	);

	const handleSave = () => {
		if (!enabled) {
			save.mutate({
				applicationId: application.applicationId,
				healthCheckSwarm: null,
			});
			return;
		}
		const parsedPort = Number.parseInt(port, 10);
		if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
			toast.error("Port must be between 1 and 65535");
			return;
		}
		const target = `http://127.0.0.1:${parsedPort}${path.startsWith("/") ? path : `/${path}`}`;
		save.mutate({
			applicationId: application.applicationId,
			healthCheckSwarm: {
				Test: [
					"CMD-SHELL",
					`curl -fsS ${target} >/dev/null 2>&1 || wget -qO- ${target} >/dev/null 2>&1 || exit 1`,
				],
				Interval: Math.max(Number.parseInt(interval, 10) || 30, 1) * SECOND,
				Timeout: Math.max(Number.parseInt(timeout, 10) || 5, 1) * SECOND,
				Retries: Math.max(Number.parseInt(retries, 10) || 3, 1),
				StartPeriod: Math.max(Number.parseInt(startPeriod, 10) || 15, 0) * SECOND,
			} as unknown,
		});
	};

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					<HeartPulse className="size-4 text-muted-foreground" />
					Healthcheck
				</span>
			}
			description={
				<>
					HTTP probe run inside the container — the image must contain{" "}
					<code className="font-mono text-xs">curl</code> or{" "}
					<code className="font-mono text-xs">wget</code>, otherwise the probe fails and Docker
					restarts the container as unhealthy. Minimal images (distroless, scratch) usually have
					neither.
				</>
			}
		>
			<div className="space-y-4">
				<div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
					<div>
						<Label htmlFor="hc-enabled">Enable healthcheck</Label>
						<p className="text-xs text-muted-foreground">
							Applied on save; the service is updated in place.
						</p>
					</div>
					<Switch id="hc-enabled" checked={enabled} onCheckedChange={setEnabled} />
				</div>

				{enabled && (
					<>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="hc-path">Path</Label>
								<Input
									id="hc-path"
									placeholder="/health"
									value={path}
									onChange={(e) => setPath(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="hc-port">Container port</Label>
								<Input
									id="hc-port"
									inputMode="numeric"
									placeholder="3000"
									value={port}
									onChange={(e) => setPort(e.target.value)}
								/>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<div className="space-y-1.5">
								<Label htmlFor="hc-interval">Interval (s)</Label>
								<Input
									id="hc-interval"
									inputMode="numeric"
									value={interval}
									onChange={(e) => setInterval(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="hc-timeout">Timeout (s)</Label>
								<Input
									id="hc-timeout"
									inputMode="numeric"
									value={timeout}
									onChange={(e) => setTimeout(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="hc-retries">Retries</Label>
								<Input
									id="hc-retries"
									inputMode="numeric"
									value={retries}
									onChange={(e) => setRetries(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="hc-start">Start period (s)</Label>
								<Input
									id="hc-start"
									inputMode="numeric"
									value={startPeriod}
									onChange={(e) => setStartPeriod(e.target.value)}
								/>
							</div>
						</div>
					</>
				)}

				<Button
					size="sm"
					disabled={save.isPending || !canWrite}
					title={canWrite ? undefined : capabilityHint("service.write")}
					onClick={handleSave}
				>
					{save.isPending && <Loader2 className="size-4 animate-spin" />}
					Save healthcheck
				</Button>
			</div>
		</SettingsSection>
	);
}
