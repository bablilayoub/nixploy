import { NavSettings } from "@/components/nav-settings";
import { SaveBarProvider } from "@/components/services/save-bar";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<div className="md:hidden">
				<NavSettings />
			</div>
			<SaveBarProvider>{children}</SaveBarProvider>
		</div>
	);
}
