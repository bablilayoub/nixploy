import { NavSettings } from "@/components/nav-settings";
import { SaveBarProvider } from "@/components/services/save-bar";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-6 md:flex-row md:items-start">
			<NavSettings className="md:sticky md:top-16 md:w-52 md:shrink-0" />
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
