/** One row of `docker images --format '{{json .}}'`. */
export interface DockerImageRow {
	Repository: string;
	Tag: string;
	ID: string;
	Size: string;
	CreatedSince: string;
}

/**
 * Collapse the per-platform duplicates the containerd image store prints:
 * a multi-arch pull (`alpine:3.20` for linux/arm64 + linux/amd64) shows up
 * once per platform with the same repository, tag and ID. One row per image
 * is what operators expect and what the table can key on.
 */
export function dedupeImageRows<T extends DockerImageRow>(rows: T[]): T[] {
	const seen = new Set<string>();
	return rows.filter((row) => {
		const key = `${row.Repository}:${row.Tag}:${row.ID}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
