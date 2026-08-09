"use client";

import { DeployProgressBar } from "@/components/layout/deploy-progress-bar";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import { Main } from "@/components/layout/main";
import { TopNav } from "@/components/layout/top-nav";

export function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-svh flex-col bg-background">
			<TopNav />
			<DeployProgressBar />
			<KeyboardShortcuts />
			<Main className="flex-1">{children}</Main>
		</div>
	);
}
