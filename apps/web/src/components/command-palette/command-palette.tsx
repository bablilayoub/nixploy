"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	AppWindow,
	BookOpen,
	Bot,
	Boxes,
	CalendarClock,
	Container,
	FileCog,
	FolderGit2,
	Globe,
	History,
	LayoutTemplate,
	LogOut,
	type LucideIcon,
	Moon,
	Plus,
	Rocket,
	ScrollText,
	Search,
	Settings,
	Shield,
	Sun,
	Tags,
	TerminalSquare,
	TriangleAlert,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isSettingsNavItemAllowed, settingsNavItems } from "@/components/nav-settings";
import { SERVICE_TYPE_META, type ServiceType } from "@/components/projects/service-types";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@/components/ui/command";
import { docsUrl } from "@/components/ui/help-link";
import { useCapabilities } from "@/hooks/use-capabilities";
import { signOut } from "@/lib/auth-client";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const RECENTS_KEY = "nixploy:command-palette:recents";
const MAX_RECENTS = 5;

type PaletteGroup =
	| "This Service"
	| "This Project"
	| "Projects"
	| "Pages"
	| "Templates"
	| "Actions";

interface PaletteItem {
	id: string;
	label: string;
	hint?: string;
	group: PaletteGroup;
	icon: LucideIcon;
	keywords: string[];
	run: () => void;
}

/**
 * Match score in [0, 1]. Used twice per item — once on the label, once on the
 * keywords at a third of the weight — so "dom" ranks "Domains" above an item
 * that merely lists "domain" as a keyword (UX audit F15).
 */
function matchScore(text: string, search: string): number {
	const haystack = text.toLowerCase();
	const needle = search.toLowerCase();
	if (!needle) return 1;
	if (haystack === needle) return 1;
	const index = haystack.indexOf(needle);
	if (index === 0) return 0.9;
	if (index > 0) return /[\s\-/·(]/.test(haystack[index - 1] ?? "") ? 0.8 : 0.6;
	// Subsequence fallback ("ndb" → "New database"), ranked below any substring.
	let cursor = 0;
	for (const char of haystack) {
		if (char === needle[cursor]) cursor += 1;
		if (cursor === needle.length) return 0.25;
	}
	return 0;
}

const KEYWORD_WEIGHT = 0.35;

function readRecentIds(): string[] {
	if (typeof window === "undefined") {
		return [];
	}
	try {
		const raw = window.localStorage.getItem(RECENTS_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function pushRecentId(id: string) {
	try {
		const next = [id, ...readRecentIds().filter((recent) => recent !== id)];
		window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, MAX_RECENTS)));
	} catch {
		// localStorage unavailable — recents are best-effort.
	}
}

/** ⌘K command palette: navigation, project services, and actions. */
export function CommandPalette({ className }: { className?: string }) {
	const trpc = useTRPC();
	const router = useRouter();
	const queryClient = useQueryClient();
	const pathname = usePathname();
	const { resolvedTheme, setTheme } = useTheme();
	const { can, isInstanceAdmin } = useCapabilities();

	const [open, setOpen] = useState(false);
	const [recentIds, setRecentIds] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");

	// Debounce the search text driving the cross-project service search.
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
		return () => clearTimeout(timer);
	}, [query]);

	// Reset the search text whenever the palette closes.
	useEffect(() => {
		if (!open) {
			setQuery("");
			setDebouncedQuery("");
		}
	}, [open]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setOpen((value) => !value);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	// Hydrate recents from localStorage each time the palette opens.
	useEffect(() => {
		if (open) {
			setRecentIds(readRecentIds());
		}
	}, [open]);

	const projectMatch = pathname.match(/^\/dashboard\/projects\/([^/]+)/);
	const projectId = projectMatch?.[1];
	const applicationMatch = pathname.match(/\/services\/application\/([^/]+)/);
	const applicationId = applicationMatch?.[1];
	const composeMatch = pathname.match(/\/services\/compose\/([^/]+)/);
	const composeId = composeMatch?.[1];
	// Any service route — the per-service destinations below (UX audit F15).
	const serviceMatch = pathname.match(
		/\/services\/(application|compose|postgres|mysql|mariadb|mongo|redis)\/([^/?]+)/,
	);
	const serviceKind = serviceMatch?.[1] as ServiceType | undefined;
	const serviceId = serviceMatch?.[2];
	const servicePath = serviceMatch ? pathname : undefined;
	// No environmentName scope: search services across all environments.
	const serviceInput = useMemo(() => ({ projectId: projectId ?? "" }), [projectId]);
	const inProject = Boolean(open && projectId);

	const projectsQuery = useQuery(trpc.project.all.queryOptions());
	const currentProjectQuery = useQuery({
		...trpc.project.one.queryOptions({ projectId: projectId ?? "" }),
		enabled: inProject,
	});
	const applicationsQuery = useQuery({
		...trpc.application.all.queryOptions(serviceInput),
		enabled: inProject,
	});
	const composeQuery = useQuery({
		...trpc.compose.all.queryOptions(serviceInput),
		enabled: inProject,
	});
	const postgresQuery = useQuery({
		...trpc.postgres.all.queryOptions(serviceInput),
		enabled: inProject,
	});
	const mysqlQuery = useQuery({
		...trpc.mysql.all.queryOptions(serviceInput),
		enabled: inProject,
	});
	const mariadbQuery = useQuery({
		...trpc.mariadb.all.queryOptions(serviceInput),
		enabled: inProject,
	});
	const mongoQuery = useQuery({
		...trpc.mongo.all.queryOptions(serviceInput),
		enabled: inProject,
	});
	const redisQuery = useQuery({
		...trpc.redis.all.queryOptions(serviceInput),
		enabled: inProject,
	});
	// Organization-wide fuzzy service search (only while typing).
	const searchQuery = useQuery({
		...trpc.project.search.queryOptions({ query: debouncedQuery }),
		enabled: open && debouncedQuery.length > 0,
	});
	const templatesQuery = useQuery({
		...trpc.template.all.queryOptions(),
		enabled: open,
	});

	const handleSignOut = useCallback(async () => {
		try {
			// better-auth resolves with `{ error }` instead of throwing.
			const { error } = await signOut();
			if (error) {
				toastError(error, "Failed to sign out");
				return;
			}
			queryClient.clear();
			router.push("/login");
			router.refresh();
		} catch (error) {
			toastError(error, "Failed to sign out");
		}
	}, [queryClient, router]);

	const items = useMemo<PaletteItem[]>(() => {
		const list: PaletteItem[] = [];
		const go = (href: string) => () => router.push(href);

		// Tabs of the service the user is looking at right now — the audit's
		// "3 clicks for logs/domains" (F15). Tab ids are the unified ones (F8).
		if (servicePath && serviceKind) {
			const isDatabase = serviceKind !== "application" && serviceKind !== "compose";
			const tab = (value: string) => go(`${servicePath}?tab=${value}`);
			const kindLabel = SERVICE_TYPE_META[serviceKind].label;
			const destinations: {
				id: string;
				label: string;
				icon: LucideIcon;
				tab: string;
				keywords: string[];
			}[] = [
				{ id: "logs", label: "Logs", icon: ScrollText, tab: "logs", keywords: ["output", "tail"] },
				...(isDatabase
					? []
					: [
							{
								id: "domains",
								label: "Domains",
								icon: Globe,
								tab: "domains",
								keywords: ["dns", "https", "tls", "url", "route"],
							},
						]),
				{
					id: "environment",
					label: "Environment",
					icon: FileCog,
					tab: "environment",
					keywords: ["env", "variables", "secrets"],
				},
				{
					id: "terminal",
					label: "Terminal",
					icon: TerminalSquare,
					tab: "terminal",
					keywords: ["shell", "exec", "console"],
				},
				...(isDatabase
					? []
					: [
							{
								id: "deploy",
								label: "Deploy this service",
								icon: Rocket,
								tab: "deployments",
								keywords: ["build", "redeploy", "release", "history"],
							},
						]),
			];
			for (const destination of destinations) {
				list.push({
					id: `service-tab:${serviceId}:${destination.id}`,
					label: destination.label,
					hint: kindLabel,
					group: "This Service",
					icon: destination.icon,
					keywords: destination.keywords,
					run: tab(destination.tab),
				});
			}
		}

		for (const project of projectsQuery.data ?? []) {
			list.push({
				id: `project:${project.projectId}`,
				label: project.name,
				hint: "Project",
				group: "Projects",
				icon: FolderGit2,
				keywords: [project.name, project.description ?? ""],
				run: go(`/dashboard/projects/${project.projectId}`),
			});
		}

		if (projectId) {
			const services: { type: ServiceType; id: string; name: string }[] = [
				...(applicationsQuery.data ?? []).map((row) => ({
					type: "application" as const,
					id: row.applicationId,
					name: row.name,
				})),
				...(composeQuery.data ?? []).map((row) => ({
					type: "compose" as const,
					id: row.composeId,
					name: row.name,
				})),
				...(postgresQuery.data ?? []).map((row) => ({
					type: "postgres" as const,
					id: row.postgresId,
					name: row.name,
				})),
				...(mysqlQuery.data ?? []).map((row) => ({
					type: "mysql" as const,
					id: row.mysqlId,
					name: row.name,
				})),
				...(mariadbQuery.data ?? []).map((row) => ({
					type: "mariadb" as const,
					id: row.mariadbId,
					name: row.name,
				})),
				...(mongoQuery.data ?? []).map((row) => ({
					type: "mongo" as const,
					id: row.mongoId,
					name: row.name,
				})),
				...(redisQuery.data ?? []).map((row) => ({
					type: "redis" as const,
					id: row.redisId,
					name: row.name,
				})),
			];

			for (const service of services) {
				const meta = SERVICE_TYPE_META[service.type];
				list.push({
					id: `service:${service.type}:${service.id}`,
					label: service.name,
					hint: meta.label,
					group: "This Project",
					icon: meta.icon,
					keywords: [service.name, meta.label, service.type],
					run: go(`/dashboard/projects/${projectId}/services/${service.type}/${service.id}`),
				});
			}

			list.push(
				{
					id: "new:application",
					label: "New application",
					hint: currentProjectQuery.data?.name,
					group: "This Project",
					icon: AppWindow,
					keywords: ["create", "deploy", "service"],
					run: go(`/dashboard/projects/${projectId}?new=application`),
				},
				{
					id: "new:database",
					label: "New database",
					hint: currentProjectQuery.data?.name,
					group: "This Project",
					icon: Plus,
					keywords: ["create", "postgres", "mysql", "mariadb", "mongo", "redis"],
					run: go(`/dashboard/projects/${projectId}?new=postgres`),
				},
				{
					id: "new:compose",
					label: "New compose service",
					hint: currentProjectQuery.data?.name,
					group: "This Project",
					icon: Boxes,
					keywords: ["create", "docker", "service", "stack"],
					run: go(`/dashboard/projects/${projectId}?new=compose`),
				},
				{
					id: "project:manage-tags",
					label: "Manage tags",
					hint: currentProjectQuery.data?.name,
					group: "This Project",
					icon: Tags,
					keywords: ["label", "filter", "tag", "tags"],
					run: go(`/dashboard/projects/${projectId}?new=tags`),
				},
			);

			if (composeId) {
				list.push({
					id: "compose:copilot",
					label: "Open Deploy Copilot",
					hint: "Compose",
					group: "This Project",
					icon: Bot,
					keywords: ["ai", "chat", "generate", "compose", "yaml", "assistant"],
					run: go(`/dashboard/projects/${projectId}/services/compose/${composeId}?copilot=1`),
				});
			}

			if (applicationId) {
				list.push({
					id: "app:copilot",
					label: "Open Deploy Copilot",
					hint: "Application",
					group: "This Project",
					icon: Bot,
					keywords: ["ai", "chat", "explain", "assistant"],
					run: go(
						`/dashboard/projects/${projectId}/services/application/${applicationId}?copilot=1`,
					),
				});
			}
		}

		list.push(
			{
				id: "page:projects",
				label: "Projects",
				group: "Pages",
				icon: FolderGit2,
				keywords: ["home", "dashboard"],
				run: go("/dashboard"),
			},
			{
				id: "page:templates",
				label: "Templates",
				group: "Pages",
				icon: LayoutTemplate,
				keywords: ["catalog", "deploy"],
				run: go("/dashboard/templates"),
			},
			{
				id: "page:docker",
				label: "Docker",
				group: "Pages",
				icon: Container,
				keywords: ["containers", "images", "swarm", "volumes", "daemon"],
				run: go("/dashboard/docker"),
			},
			{
				id: "page:monitoring",
				label: "Monitoring",
				group: "Pages",
				icon: Activity,
				keywords: ["metrics", "charts", "cpu", "memory", "fleet", "observability"],
				run: go("/dashboard/monitoring"),
			},
			{
				id: "page:incidents",
				label: "Incidents",
				hint: "Monitoring",
				group: "Pages",
				icon: TriangleAlert,
				keywords: ["alerts", "failures", "uptime", "watchdog", "observability"],
				run: go("/dashboard/monitoring?tab=incidents"),
			},
			{
				id: "page:schedules",
				label: "Schedules",
				group: "Pages",
				icon: CalendarClock,
				keywords: ["cron", "jobs", "scheduled", "tasks"],
				run: go("/dashboard/schedules"),
			},
			{
				id: "page:audit-log",
				label: "Audit log",
				hint: "Monitoring",
				group: "Pages",
				icon: History,
				keywords: ["activity", "audit", "history", "who", "changes"],
				run: go("/dashboard/monitoring?tab=audit"),
			},
			{
				id: "page:member-capabilities",
				label: "Member capabilities",
				hint: "Permissions",
				group: "Pages",
				icon: Shield,
				keywords: [
					"permissions",
					"capabilities",
					"roles",
					"members",
					"acl",
					"rbac",
					"organization",
				],
				run: go("/dashboard/settings/organization"),
			},
		);
		if (isInstanceAdmin) {
			list.push({
				id: "page:ai-settings",
				label: "AI / Deploy Copilot settings",
				hint: "Platform",
				group: "Pages",
				icon: Bot,
				keywords: ["ai", "openai", "ollama", "anthropic", "copilot", "llm"],
				run: go("/dashboard/settings/server"),
			});
		}
		for (const item of settingsNavItems) {
			if (!isSettingsNavItemAllowed(item, { can, isInstanceAdmin })) continue;
			list.push({
				id: `page:settings:${item.href}`,
				label: `Settings — ${item.label}`,
				group: "Pages",
				icon: item.icon ?? Settings,
				keywords: [
					"settings",
					item.label,
					// Legacy names users still search for
					...(item.href.endsWith("/server") ? ["web server", "host", "traefik", "ai"] : []),
					...(item.href.endsWith("/destinations") ? ["destinations", "s3", "backups"] : []),
					...(item.href.endsWith("/organization") ? ["organization", "members", "roles"] : []),
				],
				run: go(item.href),
			});
		}

		for (const template of templatesQuery.data ?? []) {
			list.push({
				id: `template:${template.id}`,
				label: template.name,
				hint: template.category,
				group: "Templates",
				icon: LayoutTemplate,
				keywords: [template.name, template.category, "template", "deploy"],
				run: go(`/dashboard/templates?template=${template.id}`),
			});
		}

		list.push(
			{
				id: "action:new-project",
				label: "New project",
				group: "Actions",
				icon: Plus,
				keywords: ["create"],
				run: go("/dashboard?new=project"),
			},
			{
				id: "action:docs",
				label: "Documentation",
				hint: "nixploy.com",
				group: "Actions",
				icon: BookOpen,
				keywords: ["docs", "help", "guide", "manual", "learn"],
				run: () => window.open(docsUrl(), "_blank", "noopener,noreferrer"),
			},
			{
				id: "action:toggle-theme",
				label: resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
				group: "Actions",
				icon: resolvedTheme === "dark" ? Sun : Moon,
				keywords: ["theme", "appearance", "dark", "light"],
				run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
			},
			{
				id: "action:sign-out",
				label: "Sign out",
				group: "Actions",
				icon: LogOut,
				keywords: ["logout", "session"],
				run: () => void handleSignOut(),
			},
		);

		return list;
	}, [
		router,
		setTheme,
		handleSignOut,
		projectId,
		resolvedTheme,
		projectsQuery.data,
		currentProjectQuery.data,
		applicationsQuery.data,
		composeQuery.data,
		postgresQuery.data,
		mysqlQuery.data,
		mariadbQuery.data,
		mongoQuery.data,
		redisQuery.data,
		templatesQuery.data,
		applicationId,
		composeId,
		serviceKind,
		serviceId,
		servicePath,
		can,
		isInstanceAdmin,
	]);

	// Live org-wide service matches while typing (debounced server search).
	const searchItems = useMemo<PaletteItem[]>(() => {
		return (searchQuery.data ?? []).map((row) => {
			const meta = SERVICE_TYPE_META[row.type];
			return {
				id: `search:${row.type}:${row.id}`,
				label: row.name,
				hint: row.projectName,
				group: "This Project" as const,
				icon: meta.icon,
				keywords: [row.name, row.projectName, meta.label, row.type],
				run: () =>
					router.push(`/dashboard/projects/${row.projectId}/services/${row.type}/${row.id}`),
			};
		});
	}, [searchQuery.data, router]);

	const recentItems = recentIds
		.map((id) => items.find((item) => item.id === id))
		.filter((item): item is PaletteItem => Boolean(item));
	const recentSet = new Set(recentItems.map((item) => item.id));

	const groups: { heading: PaletteGroup; items: PaletteItem[] }[] = [
		{
			heading: "This Service",
			items: items.filter((item) => item.group === "This Service" && !recentSet.has(item.id)),
		},
		{
			heading: "This Project",
			items: items.filter((item) => item.group === "This Project" && !recentSet.has(item.id)),
		},
		{
			heading: "Projects",
			items: items.filter((item) => item.group === "Projects" && !recentSet.has(item.id)),
		},
		{
			heading: "Pages",
			items: items.filter((item) => item.group === "Pages" && !recentSet.has(item.id)),
		},
		{
			heading: "Templates",
			items: items.filter((item) => item.group === "Templates" && !recentSet.has(item.id)),
		},
		{
			heading: "Actions",
			items: items.filter((item) => item.group === "Actions" && !recentSet.has(item.id)),
		},
	];

	const runItem = (item: PaletteItem) => {
		setOpen(false);
		// Org-wide search hits only exist while a query is typed, so they can
		// never resolve from the static item list — keep them out of recents.
		if (!item.id.startsWith("search:")) pushRecentId(item.id);
		item.run();
	};

	// cmdk scores by `value` + `keywords`; both carry the id/label/keywords so
	// the custom filter below can weight the label over the keywords (F15).
	const labelById = useMemo(() => {
		const map = new Map<string, { label: string; keywords: string[] }>();
		for (const item of [...items, ...searchItems]) {
			map.set(item.id, { label: item.label, keywords: item.keywords });
		}
		return map;
	}, [items, searchItems]);

	const filter = useCallback(
		(value: string, search: string) => {
			const entry = labelById.get(value);
			if (!entry) return 0;
			const labelScore = matchScore(entry.label, search);
			const keywordScore = entry.keywords.reduce(
				(best, keyword) => Math.max(best, matchScore(keyword, search)),
				0,
			);
			return Math.max(labelScore, keywordScore * KEYWORD_WEIGHT);
		},
		[labelById],
	);

	const renderItem = (item: PaletteItem) => (
		<CommandItem key={item.id} value={item.id} onSelect={() => runItem(item)}>
			<item.icon className="size-4" />
			<span className="truncate">{item.label}</span>
			{item.hint ? (
				<CommandShortcut className="tracking-normal">{item.hint}</CommandShortcut>
			) : null}
		</CommandItem>
	);

	return (
		<>
			<button
				type="button"
				data-slot="command-palette-trigger"
				onClick={() => setOpen(true)}
				aria-keyshortcuts="Meta+K Control+K"
				className={cn(
					"group relative hidden h-8 items-center gap-2 rounded-md bg-muted/40 pe-12 ps-2.5 text-sm font-normal text-muted-foreground shadow-none hover:bg-accent sm:inline-flex sm:w-40 lg:w-52 xl:w-64",
					className,
				)}
			>
				<Search aria-hidden className="size-4 shrink-0 opacity-70" />
				<span className="truncate">Search…</span>
				<kbd className="pointer-events-none absolute end-1.5 top-1/2 hidden h-5 -translate-y-1/2 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium select-none sm:inline-flex">
					<span className="text-xs">⌘</span>K
				</kbd>
			</button>
			<button
				type="button"
				data-slot="command-palette-trigger-mobile"
				onClick={() => setOpen(true)}
				aria-label="Search"
				className={cn(
					"inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:hidden",
					className,
				)}
			>
				<Search className="size-4" />
			</button>

			<CommandDialog
				open={open}
				onOpenChange={setOpen}
				title="Command palette"
				description="Search projects, services, pages, and actions"
				filter={filter}
				className="sm:max-w-lg"
				showCloseButton={false}
			>
				<CommandInput
					placeholder="Search projects, services, templates, pages..."
					value={query}
					onValueChange={setQuery}
				/>
				<CommandList className="max-h-[320px]">
					<CommandEmpty>No results found.</CommandEmpty>
					{debouncedQuery.length > 0 && searchItems.length > 0 ? (
						<CommandGroup heading="Services (all projects)">
							{searchItems.map(renderItem)}
						</CommandGroup>
					) : null}
					{recentItems.length > 0 ? (
						<CommandGroup heading="Recent">{recentItems.map(renderItem)}</CommandGroup>
					) : null}
					{groups.map((group) =>
						group.items.length > 0 ? (
							<CommandGroup key={group.heading} heading={group.heading}>
								{group.items.map(renderItem)}
							</CommandGroup>
						) : null,
					)}
				</CommandList>
				<CommandSeparator className="mx-0" />
				<div className="flex items-center gap-4 px-3 py-2 text-[11px] text-muted-foreground">
					<span className="flex items-center gap-1.5">
						<kbd className="rounded border bg-secondary px-1 font-mono text-[10px]">↑↓</kbd>
						Navigate
					</span>
					<span className="flex items-center gap-1.5">
						<kbd className="rounded border bg-secondary px-1 font-mono text-[10px]">↵</kbd>
						Select
					</span>
					<span className="flex items-center gap-1.5">
						<kbd className="rounded border bg-secondary px-1 font-mono text-[10px]">esc</kbd>
						Close
					</span>
				</div>
			</CommandDialog>
		</>
	);
}
