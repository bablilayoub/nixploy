import { NavSettings } from "@/components/nav-settings";
import { SaveBarProvider } from "@/components/services/save-bar";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-8 lg:flex-row lg:items-start">
			<NavSettings className="lg:sticky lg:top-24 lg:w-44 lg:shrink-0" />
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
