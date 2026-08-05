import type { Metadata } from "next";

import { NotificationsView } from "@/components/settings/notifications/notifications-view";

export const metadata: Metadata = {
	title: "Notification Settings",
};

export default function NotificationsSettingsPage() {
	return <NotificationsView />;
}
