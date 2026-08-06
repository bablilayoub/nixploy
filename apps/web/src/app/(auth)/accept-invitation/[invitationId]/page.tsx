import type { Metadata } from "next";

import { AcceptInvitationForm } from "./accept-invitation-form";

export const metadata: Metadata = {
	title: "Accept invitation",
};

export default async function AcceptInvitationPage({
	params,
}: {
	params: Promise<{ invitationId: string }>;
}) {
	const { invitationId } = await params;
	return <AcceptInvitationForm invitationId={invitationId} />;
}
