import { userHasOrganization } from "@nixploy/server/modules/projects/index";
import { redirect } from "next/navigation";

import { NavMain } from "@/components/nav-projects";
import { OrgBrandingProvider } from "@/components/org-branding-provider";
import { NoOrganization } from "@/components/shell/no-organization";
import { TopNav } from "@/components/shell/top-nav";
import { getSession } from "@/lib/auth-server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	// Authoritative session check — the middleware only looks for the cookie.
	const session = await getSession();
	if (!session) {
		redirect("/login");
	}

	// Without an organization every org-scoped query throws FORBIDDEN, so show
	// a recovery screen rather than a dashboard full of error panels.
	const hasOrganization = await userHasOrganization(session.user.id);

	return (
		<OrgBrandingProvider>
			<div className="flex min-h-svh flex-col bg-background">
				<TopNav />
				<div className="flex min-h-0 flex-1">
					<NavMain />
					<main className="min-w-0 flex-1 bg-background">
						<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
							{hasOrganization ? children : <NoOrganization userName={session.user.name} />}
						</div>
					</main>
				</div>
			</div>
		</OrgBrandingProvider>
	);
}
