import { NavSettings } from "@/components/nav-settings";
import { SaveBarProvider } from "@/components/services/save-bar";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
			<NavSettings className="lg:sticky lg:top-24 lg:w-40 lg:shrink-0 lg:max-h-[calc(100svh-8rem)] lg:overflow-y-auto" />
			{/*
			 * One save bar for the settings page being viewed: the cards of the
			 * other routes are unmounted, so only this page's dirty forms can
			 * register (UX audit F12).
			 */}
			<div className="min-w-0 flex-1">
				<SaveBarProvider>{children}</SaveBarProvider>
			</div>
		</div>
	);
}
