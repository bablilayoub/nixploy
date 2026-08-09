import { isTwoFactorGateBlocked } from "@nixploy/server/modules/auth/two-factor-gate";
import {
	resolveCallerOrganizationId,
	userHasOrganization,
} from "@nixploy/server/modules/projects/index";
import { redirect } from "next/navigation";

import { TwoFactorRequiredGate } from "@/components/auth/two-factor-required-gate";
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

	// Org-level 2FA enforcement: replace the whole dashboard (including the
	// shell, whose tRPC queries are gated anyway) with the setup interstitial.
	if (hasOrganization) {
		try {
			const organizationId = await resolveCallerOrganizationId(
				session.user.id,
				session.session.activeOrganizationId,
			);
			if (await isTwoFactorGateBlocked(session.user.id, organizationId)) {
				return <TwoFactorRequiredGate />;
			}
		} catch {
			// Org resolution failed — org-scoped pages handle that themselves.
		}
	}

	return (
		<OrgBrandingProvider>
			<AuthenticatedLayout>
				{hasOrganization ? children : <NoOrganization userName={session.user.name} />}
			</AuthenticatedLayout>
		</OrgBrandingProvider>
	);
}
