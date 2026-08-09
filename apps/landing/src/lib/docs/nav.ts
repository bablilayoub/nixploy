export type DocsNavItem = {
	href: string;
	label: string;
	/** When true, item is the docs index at /docs */
	index?: boolean;
};

export type DocsNavGroup = {
	title: string;
	items: DocsNavItem[];
};

export const docsNav: DocsNavGroup[] = [
	{
		title: "Start",
		items: [
			{ href: "/docs", label: "Overview", index: true },
			{ href: "/docs/install", label: "Install" },
			{ href: "/docs/getting-started", label: "Getting started" },
			{ href: "/docs/migrate", label: "Migrate" },
		],
	},
	{
		title: "Platform",
		items: [
			{ href: "/docs/deploy", label: "Deploy & build" },
			{ href: "/docs/domains", label: "Domains & TLS" },
			{ href: "/docs/git", label: "Git & previews" },
			{ href: "/docs/templates", label: "Templates" },
			{ href: "/docs/databases", label: "Databases" },
			{ href: "/docs/backups", label: "Backups" },
		],
	},
	{
		title: "Operate",
		items: [
			{ href: "/docs/observability", label: "Observability" },
			{ href: "/docs/servers", label: "Servers & Docker" },
			{ href: "/docs/security", label: "Auth & security" },
			{ href: "/docs/schedules", label: "Schedules & notify" },
		],
	},
	{
		title: "Automate",
		items: [
			{ href: "/api", label: "REST API" },
			{ href: "/docs/cli", label: "CLI" },
			{ href: "/docs/gitops", label: "GitOps" },
			{ href: "/docs/mcp", label: "MCP" },
			{ href: "/docs/ai", label: "Deploy Copilot" },
		],
	},
];

export const docsSlugs = docsNav
	.flatMap((g) => g.items)
	.filter((i) => i.href.startsWith("/docs/") && i.href !== "/docs")
	.map((i) => i.href.replace("/docs/", ""));
