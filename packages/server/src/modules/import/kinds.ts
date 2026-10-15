/** Import-free so the panel can use exactly the providers the API accepts. */
export const IMPORT_SOURCES = ["dokploy", "coolify"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
	dokploy: "Dokploy",
	coolify: "Coolify",
};
