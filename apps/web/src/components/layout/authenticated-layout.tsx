"use client";

import { ActivityTray } from "@/components/layout/activity-tray";
import { DeployProgressBar } from "@/components/layout/deploy-progress-bar";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import { Main } from "@/components/layout/main";
import { TopNav } from "@/components/layout/top-nav";
import { useLiveEvents } from "@/hooks/use-live-events";

export function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
	// One `/ws/events` socket for the whole dashboard: deployment, queue and
	// service-status pushes are mapped onto query invalidations here so no
	// screen below needs a `refetchInterval` of its own (architecture #14).
	useLiveEvents();
	return (
		<div className="flex min-h-svh flex-col bg-background">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
			>
				Skip to content
			</a>
			<TopNav />
			<DeployProgressBar />
			<KeyboardShortcuts />
			<Main id="main-content" tabIndex={-1} className="flex-1 outline-none">
				{children}
			</Main>
			<ActivityTray />
		</div>
	);
}
