import { Lock } from "lucide-react";

export function BrowserFrame({
	url = "panel.nixploy.com",
	children,
}: {
	url?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] shadow-[0_24px_80px_-32px_rgba(16,20,24,0.55)]">
			<div className="flex items-center gap-2 border-b border-white/10 bg-[#1a2028] px-3 py-2">
				<div className="flex gap-1.5">
					<span className="size-2 rounded-full bg-white/20" />
					<span className="size-2 rounded-full bg-white/20" />
					<span className="size-2 rounded-full bg-white/20" />
				</div>
				<div className="mx-auto flex items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2.5 py-0.5 font-mono text-[10px] text-white/50">
					<Lock className="size-2.5" strokeWidth={2} />
					{url}
				</div>
				<div className="w-10" aria-hidden />
			</div>
			{children}
		</div>
	);
}
