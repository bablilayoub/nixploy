"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	AppWindow,
	Bot,
	Boxes,
	CalendarClock,
	Container,
	FolderGit2,
	LayoutTemplate,
	LogOut,
	type LucideIcon,
	Moon,
	Plus,
	Search,
	Settings,
	Shield,
	Sun,
	Tags,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { settingsNavItems } from "@/components/nav-settings";
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
import { signOut } from "@/lib/auth-client";
import { useTRPC } from "@/lib/trpc";

const RECENTS_KEY = "nixploy:command-palette:recents";
const MAX_RECENTS = 5;

type PaletteGroup = "This Project" | "Projects" | "Pages" | "Templates" | "Actions";

interface PaletteItem {
	id: string;
	label: string;
	hint?: string;
	group: PaletteGroup;
	icon: LucideIcon;
	keywords: string[];
	run: () => void;
}

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
export function CommandPalette() {
	const trpc = useTRPC();
	const router = useRouter();
	const queryClient = useQueryClient();
	const pathname = usePathname();
	const { resolvedTheme, setTheme } = useTheme();

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
			await signOut();
			queryClient.clear();
			router.push("/login");
			router.refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to sign out");
		}
	}, [queryClient, router]);

	const items = useMemo<PaletteItem[]>(() => {
		const list: PaletteItem[] = [];
		const go = (href: string) => () => router.push(href);

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
					label: "New Application",
					hint: currentProjectQuery.data?.name,
					group: "This Project",
					icon: AppWindow,
					keywords: ["create", "deploy", "service"],
					run: go(`/dashboard/projects/${projectId}?new=application`),
				},
				{
					id: "new:database",
					label: "New Database",
					hint: currentProjectQuery.data?.name,
					group: "This Project",
					icon: Plus,
					keywords: ["create", "postgres", "mysql", "mariadb", "mongo", "redis"],
					run: go(`/dashboard/projects/${projectId}?new=postgres`),
				},
				{
					id: "new:compose",
					label: "New Compose Service",
					hint: currentProjectQuery.data?.name,
					group: "This Project",
					icon: Boxes,
					keywords: ["create", "docker", "service", "stack"],
					run: go(`/dashboard/projects/${projectId}?new=compose`),
				},
				{
					id: "project:manage-tags",
					label: "Manage Tags",
					hint: currentProjectQuery.data?.name,
					group: "This Project",
					icon: Tags,
					keywords: ["label", "filter", "tag", "tags"],
					run: go(`/dashboard/projects/${projectId}`),
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
					run: go(`/dashboard/projects/${projectId}/services/compose/${composeId}`),
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
					run: go(`/dashboard/projects/${projectId}/services/application/${applicationId}`),
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
				id: "page:schedules",
				label: "Schedules",
				group: "Pages",
				icon: CalendarClock,
				keywords: ["cron", "jobs", "scheduled", "tasks"],
				run: go("/dashboard/schedules"),
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
			{
				id: "page:ai-settings",
				label: "AI / Deploy Copilot settings",
				hint: "Platform",
				group: "Pages",
				icon: Bot,
				keywords: ["ai", "openai", "ollama", "anthropic", "copilot", "llm"],
				run: go("/dashboard/settings/server"),
			},
		);
		for (const item of settingsNavItems) {
			list.push({
				id: `page:settings:${item.href}`,
				label: `Settings — ${item.label}`,
				group: "Pages",
				icon: item.icon ?? Settings,
				keywords: [
					"settings",
					item.label,
					// Legacy names users still search for
					...(item.href.endsWith("/activity") ? ["activity", "audit"] : []),
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
				label: "New Project",
				group: "Actions",
				icon: Plus,
				keywords: ["create"],
				run: go("/dashboard"),
			},
			{
				id: "action:toggle-theme",
				label: resolvedTheme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
				group: "Actions",
				icon: resolvedTheme === "dark" ? Sun : Moon,
				keywords: ["theme", "appearance", "dark", "light"],
				run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
			},
			{
				id: "action:sign-out",
				label: "Sign Out",
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
		pushRecentId(item.id);
		item.run();
	};

	const renderItem = (item: PaletteItem) => (
		<CommandItem
			key={item.id}
			value={item.id}
			keywords={[item.label, ...item.keywords]}
			onSelect={() => runItem(item)}
		>
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
				className="hidden h-8 items-center gap-2 rounded-md border bg-secondary px-3 text-sm text-muted-foreground transition-colors hover:bg-accent sm:flex"
			>
				<Search className="size-3.5" />
				<span>Search...</span>
				<kbd className="pointer-events-none ml-2 flex items-center gap-0.5 rounded border bg-background px-1.5 font-mono text-[10px] text-muted-foreground">
					<span className="text-xs">⌘</span>K
				</kbd>
			</button>
			<button
				type="button"
				data-slot="command-palette-trigger-mobile"
				onClick={() => setOpen(true)}
				aria-label="Search"
				className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:hidden"
			>
				<Search className="size-4" />
			</button>

			<CommandDialog
				open={open}
				onOpenChange={setOpen}
				title="Command Palette"
				description="Search projects, services, pages, and actions"
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
