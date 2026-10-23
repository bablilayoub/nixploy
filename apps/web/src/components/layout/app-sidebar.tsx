"use client";

import { ArrowUpRight, BookOpen, LifeBuoy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBranding } from "@/components/branding-provider";
import { isSidebarNavActive, sidebarNavGroups } from "@/components/layout/sidebar-data";
import { OrgSwitcher } from "@/components/org-switcher";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { useCapabilities } from "@/hooks/use-capabilities";

/** Mobile workspace navigation, using the standard shadcn Sheet. */
export function AppSidebar() {
	const pathname = usePathname();
	const branding = useBranding();
	const { can } = useCapabilities({ strict: true });
	const { openMobile, setOpenMobile } = useSidebar();
	const close = () => setOpenMobile(false);
	return (
		<Sheet open={openMobile} onOpenChange={setOpenMobile}>
			<SheetContent side="left" className="w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
				<SheetHeader>
					<SheetTitle>{branding.productName}</SheetTitle>
					<SheetDescription>Workspace navigation</SheetDescription>
				</SheetHeader>
				<div className="flex min-w-0 flex-1 flex-col gap-4 px-4 pb-6">
					<OrgSwitcher className="w-full justify-between" />
					<Separator />
					<nav
						id="workspace-navigation"
						aria-label="Mobile workspace navigation"
						className="flex flex-col gap-5"
					>
						{sidebarNavGroups.map((group) => (
							<div key={group.title} className="flex flex-col gap-1">
								<p className="px-3 py-2 text-xs font-medium text-muted-foreground">
									{group.title === "Platform" ? "Workspace" : group.title}
								</p>
								{group.items
									.filter((item) => !item.capability || can(item.capability))
									.map((item) => (
										<Button
											asChild
											key={item.url}
											variant={isSidebarNavActive(pathname, item.url) ? "secondary" : "ghost"}
											className="w-full justify-start"
										>
											<Link
												href={item.url}
												onClick={close}
												aria-current={isSidebarNavActive(pathname, item.url) ? "page" : undefined}
											>
												<item.icon aria-hidden="true" />
												{item.title}
											</Link>
										</Button>
									))}
							</div>
						))}
					</nav>
					<Separator />
					<Button asChild variant="ghost" className="justify-start">
						<a
							href={branding.docsUrl ?? "https://nixploy.com/docs"}
							target="_blank"
							rel="noreferrer"
						>
							<BookOpen aria-hidden="true" />
							Documentation
							<ArrowUpRight className="ml-auto" aria-hidden="true" />
						</a>
					</Button>
					{branding.supportUrl && (
						<Button asChild variant="ghost" className="justify-start">
							<a href={branding.supportUrl} target="_blank" rel="noreferrer">
								<LifeBuoy aria-hidden="true" />
								Support
								<ArrowUpRight className="ml-auto" aria-hidden="true" />
							</a>
						</Button>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
