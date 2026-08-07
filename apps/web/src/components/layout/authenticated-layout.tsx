"use client";

import { Main } from "@/components/layout/main";
import { TopNav } from "@/components/layout/top-nav";

export function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-svh flex-col bg-background">
			<TopNav />
			<Main className="flex-1">{children}</Main>
		</div>
	);
}
