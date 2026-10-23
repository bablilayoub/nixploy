"use client";

import { ArrowUpRight, BookOpen, LifeBuoy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBranding } from "@/components/branding-provider";
import { isSidebarNavActive, sidebarNavGroups } from "@/components/layout/sidebar-data";
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
	SidebarSeparator,
	useSidebar,
} from "@/components/ui/sidebar";
import { useCapabilities } from "@/hooks/use-capabilities";

/** shadcn sidebar-07 composition, connected to Nixploy's real navigation and branding. */
export function AppSidebar() {
	const pathname = usePathname();
	const branding = useBranding();
	const { can } = useCapabilities({ strict: true });
	const { setOpenMobile } = useSidebar();
	const close = () => setOpenMobile(false);
	return (
		<Sidebar variant="inset" collapsible="offcanvas">
			<SidebarHeader className="gap-5 px-4 py-5">
				<Link
					href="/dashboard"
					aria-label={branding.productName}
					onClick={close}
					className="flex min-h-11 min-w-0 items-center overflow-hidden"
				>
					<Logo />
				</Link>
				<OrgSwitcher className="w-full max-w-full justify-between" />
			</SidebarHeader>
			<SidebarSeparator />
			<SidebarContent className="px-2 py-3">
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
													className="h-auto min-h-11 py-3"
												>
													<Link
														href={item.url}
														aria-current={
															isSidebarNavActive(pathname, item.url) ? "page" : undefined
														}
														onClick={close}
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
			</SidebarContent>
			<SidebarFooter className="p-4">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild className="h-auto min-h-11 py-3">
							<a
								href={branding.docsUrl ?? "https://nixploy.com/docs"}
								target="_blank"
								rel="noreferrer"
							>
								<BookOpen aria-hidden="true" />
								<span>Documentation</span>
								<ArrowUpRight className="ml-auto" aria-hidden="true" />
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
					{branding.supportUrl && (
						<SidebarMenuItem>
							<SidebarMenuButton asChild className="h-auto min-h-11 py-3">
								<a href={branding.supportUrl} target="_blank" rel="noreferrer">
									<LifeBuoy aria-hidden="true" />
									<span>Support</span>
									<ArrowUpRight className="ml-auto" aria-hidden="true" />
								</a>
							</SidebarMenuButton>
						</SidebarMenuItem>
					)}
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
