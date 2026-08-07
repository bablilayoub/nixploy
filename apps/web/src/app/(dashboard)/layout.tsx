import { userHasOrganization } from "@nixploy/server/modules/projects/index";
import { redirect } from "next/navigation";

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { OrgBrandingProvider } from "@/components/org-branding-provider";
import { NoOrganization } from "@/components/shell/no-organization";
import { getSession } from "@/lib/auth-server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	const session = await getSession();
	if (!session) {
		redirect("/login");
	}

	const hasOrganization = await userHasOrganization(session.user.id);

	return (
		<OrgBrandingProvider>
			<AuthenticatedLayout>
				{hasOrganization ? children : <NoOrganization userName={session.user.name} />}
			</AuthenticatedLayout>
		</OrgBrandingProvider>
	);
}
