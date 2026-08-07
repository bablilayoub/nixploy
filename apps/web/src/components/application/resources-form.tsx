"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

/** Parse a docker memory string ("512M", "1G", "2Gi") into MB. */
const parseMemoryMb = (value: string | null): number => {
	if (!value) return 0;
	const match = /^(\d+(?:\.\d+)?)\s*(m|mb|mi|g|gb|gi)?$/i.exec(value.trim());
	if (!match) return 0;
	const amount = Number.parseFloat(match[1]);
	const unit = (match[2] ?? "m").toLowerCase();
	return unit.startsWith("g") ? Math.round(amount * 1024) : Math.round(amount);
};

/** Parse a docker cpu string ("0.5", "500m", "2") into cores. */
const parseCpuCores = (value: string | null): number => {
	if (!value) return 0;
	const trimmed = value.trim();
	if (trimmed.endsWith("m")) {
		const millis = Number.parseFloat(trimmed.slice(0, -1));
		return Number.isNaN(millis) ? 0 : millis / 1000;
	}
	const cores = Number.parseFloat(trimmed);
	return Number.isNaN(cores) ? 0 : cores;
};

const formatMemory = (mb: number) =>
	mb === 0
		? "No limit"
		: mb >= 1024
			? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`
			: `${mb} MB`;

const formatCpu = (cores: number) =>
	cores === 0 ? "No limit" : `${cores} ${cores === 1 ? "core" : "cores"}`;

export function ResourcesForm({ application }: { application: Application }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const applicationId = application.applicationId;

	const [replicas, setReplicas] = useState(application.replicas);
	const [memoryReservation, setMemoryReservation] = useState(
		parseMemoryMb(application.memoryReservation),
	);
	const [memoryLimit, setMemoryLimit] = useState(parseMemoryMb(application.memoryLimit));
	const [cpuReservation, setCpuReservation] = useState(parseCpuCores(application.cpuReservation));
	const [cpuLimit, setCpuLimit] = useState(parseCpuCores(application.cpuLimit));

	useEffect(() => {
		setReplicas(application.replicas);
		setMemoryReservation(parseMemoryMb(application.memoryReservation));
		setMemoryLimit(parseMemoryMb(application.memoryLimit));
		setCpuReservation(parseCpuCores(application.cpuReservation));
		setCpuLimit(parseCpuCores(application.cpuLimit));
	}, [application]);

	const update = useMutation(
		trpc.application.update.mutationOptions({
			onSuccess: () => {
				toast.success("Resources updated");
				queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({ applicationId }),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const onSave = () =>
		update.mutate({
			applicationId,
			replicas,
			memoryReservation: memoryReservation > 0 ? `${memoryReservation}M` : null,
			memoryLimit: memoryLimit > 0 ? `${memoryLimit}M` : null,
			cpuReservation: cpuReservation > 0 ? String(cpuReservation) : null,
			cpuLimit: cpuLimit > 0 ? String(cpuLimit) : null,
		});

	return (
		<SettingsSection
			title="Resources"
			description="Replicas and CPU / memory reservations and limits."
		>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<Label>Replicas</Label>
						<span className="text-sm text-muted-foreground">{replicas}</span>
					</div>
					<Slider
						value={[replicas]}
						onValueChange={([v]) => setReplicas(v)}
						min={0}
						max={10}
						step={1}
					/>
					<p className="text-xs text-muted-foreground">
						0 replicas stops the application without deleting its configuration.
					</p>
				</div>

				<div className="grid gap-6 sm:grid-cols-2">
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label>Memory Reservation</Label>
							<span className="text-sm text-muted-foreground">
								{memoryReservation === 0 ? "None" : formatMemory(memoryReservation)}
							</span>
						</div>
						<Slider
							value={[memoryReservation]}
							onValueChange={([v]) => setMemoryReservation(v)}
							min={0}
							max={8192}
							step={128}
						/>
					</div>
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label>Memory Limit</Label>
							<span className="text-sm text-muted-foreground">{formatMemory(memoryLimit)}</span>
						</div>
						<Slider
							value={[memoryLimit]}
							onValueChange={([v]) => setMemoryLimit(v)}
							min={0}
							max={8192}
							step={128}
						/>
					</div>
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label>CPU Reservation</Label>
							<span className="text-sm text-muted-foreground">
								{cpuReservation === 0 ? "None" : formatCpu(cpuReservation)}
							</span>
						</div>
						<Slider
							value={[cpuReservation]}
							onValueChange={([v]) => setCpuReservation(v)}
							min={0}
							max={8}
							step={0.25}
						/>
					</div>
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label>CPU Limit</Label>
							<span className="text-sm text-muted-foreground">{formatCpu(cpuLimit)}</span>
						</div>
						<Slider
							value={[cpuLimit]}
							onValueChange={([v]) => setCpuLimit(v)}
							min={0}
							max={8}
							step={0.25}
						/>
					</div>
				</div>

				<div className="flex justify-end">
					<Button onClick={onSave} disabled={update.isPending}>
						{update.isPending && <Loader2 className="size-4 animate-spin" />}
						Save Resources
					</Button>
				</div>
			</div>
		</SettingsSection>
	);
}
