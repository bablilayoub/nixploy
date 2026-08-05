import { settingsNavItems } from "@/components/nav-settings";
import { SubNav } from "@/components/shell";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-6">
			<SubNav items={settingsNavItems} />
			<div className="min-w-0">{children}</div>
		</div>
	);
}
