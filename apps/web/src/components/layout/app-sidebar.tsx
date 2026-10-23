"use client";

import { BookOpen, LifeBuoy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBranding } from "@/components/branding-provider";
import { isSidebarNavActive, sidebarNavGroups } from "@/components/layout/sidebar-data";
import { filterSettingsNavGroups, settingsNavGroups } from "@/components/nav-settings";
import { OrgSwitcher } from "@/components/org-switcher";
import { Logo } from "@/components/shell/logo";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarSeparator,
	useSidebar,
} from "@/components/ui/sidebar";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useMounted } from "@/hooks/use-mounted";

/** Composition from the official sidebar-07 block; all controls use stock variants. */
export function AppSidebar() {
	const pathname = usePathname();
	const branding = useBranding();
	const { can, isInstanceAdmin } = useCapabilities({ strict: true });
	const mounted = useMounted();
	const { setOpenMobile } = useSidebar();
	const close = () => setOpenMobile(false);
	const settings = pathname.startsWith("/dashboard/settings");
	const groups = filterSettingsNavGroups(settingsNavGroups, {
		can,
		isInstanceAdmin: mounted && isInstanceAdmin,
	});
	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild size="lg" tooltip={branding.productName}>
							<Link href="/dashboard" onClick={close}>
								<Logo />
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				<div className="group-data-[collapsible=icon]:hidden">
					<OrgSwitcher className="w-full justify-between" />
				</div>
			</SidebarHeader>
			<SidebarSeparator />
			<SidebarContent>
				<nav id="workspace-navigation" aria-label="Workspace navigation">
					{sidebarNavGroups.map((group) => (
						<SidebarGroup key={group.title}>
							<SidebarGroupLabel>
								{group.title === "Platform" ? "Workspace" : group.title}
							</SidebarGroupLabel>
							<SidebarGroupContent>
								<SidebarMenu>
									{group.items
										.filter((item) => !item.capability || can(item.capability))
										.map((item) => (
											<SidebarMenuItem key={item.url}>
												<SidebarMenuButton
													asChild
													isActive={isSidebarNavActive(pathname, item.url)}
													tooltip={item.title}
												>
													<Link
														href={item.url}
														onClick={close}
														aria-current={
															isSidebarNavActive(pathname, item.url) ? "page" : undefined
														}
													>
														<item.icon aria-hidden="true" />
														<span>{item.title}</span>
													</Link>
												</SidebarMenuButton>
											</SidebarMenuItem>
										))}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					))}
				</nav>
				{settings && (
					<>
						<SidebarSeparator />
						<nav aria-label="Settings navigation">
							{groups.map((group) => (
								<SidebarGroup key={group.label}>
									<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
									<SidebarGroupContent>
										<SidebarMenu>
											{group.items.map((item) => (
												<SidebarMenuItem key={item.href}>
													<SidebarMenuButton
														asChild
														isActive={pathname === item.href}
														tooltip={item.label}
													>
														<Link
															href={item.href}
															onClick={close}
															aria-current={pathname === item.href ? "page" : undefined}
														>
															{item.icon && <item.icon aria-hidden="true" />}
															<span>{item.label}</span>
														</Link>
													</SidebarMenuButton>
												</SidebarMenuItem>
											))}
										</SidebarMenu>
									</SidebarGroupContent>
								</SidebarGroup>
							))}
						</nav>
					</>
				)}
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Documentation">
							<a
								href={branding.docsUrl ?? "https://nixploy.com/docs"}
								target="_blank"
								rel="noreferrer"
							>
								<BookOpen aria-hidden="true" />
								<span>Documentation</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
					{branding.supportUrl && (
						<SidebarMenuItem>
							<SidebarMenuButton asChild tooltip="Support">
								<a href={branding.supportUrl} target="_blank" rel="noreferrer">
									<LifeBuoy aria-hidden="true" />
									<span>Support</span>
								</a>
							</SidebarMenuButton>
						</SidebarMenuItem>
					)}
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
