type RunDocker = (command: string) => Promise<string>;

interface DockerVersion {
	Server?: { Version?: string; Os?: string; Arch?: string };
	Client?: { Version?: string };
}

interface DockerDiskUsageRow {
	Type: string;
	TotalCount: string;
	Active: string;
	Size: string;
	Reclaimable: string;
}

/** Expose only the known error and container ID, never raw Docker/SSH stderr. */
function missingSnapshotContainer(error: unknown): string | null {
	const stderr = (error as { stderr?: unknown } | null)?.stderr;
	const message = error instanceof Error ? error.message : "";
	return (
		/\brw layer snapshot not found for container ([a-f0-9]{64})\b/i.exec(
			`${message}\n${typeof stderr === "string" ? stderr : ""}`,
		)?.[1] ?? null
	);
}

/** Keep engine details available when Docker cannot size a stale task's layer. */
export async function readDockerSystemInfo(run: RunDocker) {
	const [version, diskUsage] = await Promise.all([
		run("docker version --format '{{json .}}'"),
		run("docker system df --format '{{json .}}'")
			.then((output) => ({ output, containerId: null }))
			.catch((error: unknown) => {
				const containerId = missingSnapshotContainer(error);
				if (!containerId) throw error;
				return { output: null, containerId };
			}),
	]);
	return {
		version: JSON.parse(version.trim()) as DockerVersion,
		df: diskUsage.output
			? diskUsage.output
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean)
					.map((line) => JSON.parse(line) as DockerDiskUsageRow)
			: [],
		diskUsageError: diskUsage.containerId
			? { code: "MISSING_CONTAINER_SNAPSHOT" as const, containerId: diskUsage.containerId }
			: null,
	};
}
