"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { capabilityHint } from "@/components/services/capability-hint";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

const MEMORY_MAX_MB = 8192;
const MEMORY_STEP_MB = 128;
const CPU_MAX_CORES = 8;
const CPU_STEP = 0.25;

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

/**
 * Slider upper bound: the default range, extended (rounded up to the step) so
 * a stored value above it stays representable instead of being snapped down
 * on the first touch.
 */
const sliderMax = (value: number, defaultMax: number, step: number) =>
	value > defaultMax ? Math.ceil(value / step) * step : defaultMax;

function RangeNotice({ label, value }: { label: string; value: string }) {
	return (
		<p className="text-xs text-warning">
			Stored {label} ({value}) exceeds the usual slider range; the slider was extended to keep it.
		</p>
	);
}

export function ResourcesForm({ application }: { application: Application }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;

	const [replicas, setReplicas] = useState(application.replicas);
	const [memoryReservation, setMemoryReservation] = useState(
		parseMemoryMb(application.memoryReservation),
	);
	const [memoryLimit, setMemoryLimit] = useState(parseMemoryMb(application.memoryLimit));
	const [cpuReservation, setCpuReservation] = useState(parseCpuCores(application.cpuReservation));
	const [cpuLimit, setCpuLimit] = useState(parseCpuCores(application.cpuLimit));
	// Only mirror server values while the user is not editing — background
	// refetches (deploy status flips, window focus) must not reset the sliders.
	const [dirty, setDirty] = useState(false);

	const edit =
		(setter: (value: number) => void) =>
		([value]: number[]) => {
			setDirty(true);
			setter(value);
		};

	useEffect(() => {
		if (dirty) return;
		setReplicas(application.replicas);
		setMemoryReservation(parseMemoryMb(application.memoryReservation));
		setMemoryLimit(parseMemoryMb(application.memoryLimit));
		setCpuReservation(parseCpuCores(application.cpuReservation));
		setCpuLimit(parseCpuCores(application.cpuLimit));
	}, [
		dirty,
		application.replicas,
		application.memoryReservation,
		application.memoryLimit,
		application.cpuReservation,
		application.cpuLimit,
	]);

	const update = useMutation(
		trpc.application.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Resources updated");
				await queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({ applicationId }),
				});
				setDirty(false);
			},
			onError: (error) => toastError(error),
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

	const canWrite = can("service.write");

	// Stored values (not the draft) decide whether the range needs extending.
	const storedMemoryReservation = parseMemoryMb(application.memoryReservation);
	const storedMemoryLimit = parseMemoryMb(application.memoryLimit);
	const storedCpuReservation = parseCpuCores(application.cpuReservation);
	const storedCpuLimit = parseCpuCores(application.cpuLimit);

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
						onValueChange={edit(setReplicas)}
						min={0}
						max={Math.max(10, application.replicas)}
						step={1}
					/>
					<p className="text-xs text-muted-foreground">
						0 replicas stops the application without deleting its configuration.
					</p>
				</div>

				<div className="grid gap-6 sm:grid-cols-2">
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label>Memory reservation</Label>
							<span className="text-sm text-muted-foreground">
								{memoryReservation === 0 ? "None" : formatMemory(memoryReservation)}
							</span>
						</div>
						<Slider
							value={[memoryReservation]}
							onValueChange={edit(setMemoryReservation)}
							min={0}
							max={sliderMax(storedMemoryReservation, MEMORY_MAX_MB, MEMORY_STEP_MB)}
							step={MEMORY_STEP_MB}
						/>
						{storedMemoryReservation > MEMORY_MAX_MB && (
							<RangeNotice label="reservation" value={formatMemory(storedMemoryReservation)} />
						)}
					</div>
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label>Memory limit</Label>
							<span className="text-sm text-muted-foreground">{formatMemory(memoryLimit)}</span>
						</div>
						<Slider
							value={[memoryLimit]}
							onValueChange={edit(setMemoryLimit)}
							min={0}
							max={sliderMax(storedMemoryLimit, MEMORY_MAX_MB, MEMORY_STEP_MB)}
							step={MEMORY_STEP_MB}
						/>
						{storedMemoryLimit > MEMORY_MAX_MB && (
							<RangeNotice label="limit" value={formatMemory(storedMemoryLimit)} />
						)}
					</div>
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label>CPU reservation</Label>
							<span className="text-sm text-muted-foreground">
								{cpuReservation === 0 ? "None" : formatCpu(cpuReservation)}
							</span>
						</div>
						<Slider
							value={[cpuReservation]}
							onValueChange={edit(setCpuReservation)}
							min={0}
							max={sliderMax(storedCpuReservation, CPU_MAX_CORES, CPU_STEP)}
							step={CPU_STEP}
						/>
						{storedCpuReservation > CPU_MAX_CORES && (
							<RangeNotice label="reservation" value={formatCpu(storedCpuReservation)} />
						)}
					</div>
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<Label>CPU limit</Label>
							<span className="text-sm text-muted-foreground">{formatCpu(cpuLimit)}</span>
						</div>
						<Slider
							value={[cpuLimit]}
							onValueChange={edit(setCpuLimit)}
							min={0}
							max={sliderMax(storedCpuLimit, CPU_MAX_CORES, CPU_STEP)}
							step={CPU_STEP}
						/>
						{storedCpuLimit > CPU_MAX_CORES && (
							<RangeNotice label="limit" value={formatCpu(storedCpuLimit)} />
						)}
					</div>
				</div>

				<div className="flex items-center justify-end gap-3">
					<UnsavedChangesPill dirty={dirty} />
					<DisabledHint hint={canWrite ? undefined : capabilityHint("service.write")}>
						<Button onClick={onSave} disabled={update.isPending || !canWrite}>
							{update.isPending && <Loader2 className="size-4 animate-spin" />}
							Save resources
						</Button>
					</DisabledHint>
				</div>
			</div>
		</SettingsSection>
	);
}
