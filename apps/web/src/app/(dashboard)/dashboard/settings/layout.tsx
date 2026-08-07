import { settingsNavGroups } from "@/components/nav-settings";
import { SubNav } from "@/components/shell";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-6 md:flex-row md:items-start">
			<SubNav
				orientation="vertical"
				groups={settingsNavGroups}
				className="md:sticky md:top-20 md:w-52 md:shrink-0"
			/>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}
