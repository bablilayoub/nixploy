import { ArrowDown } from "lucide-react";

/** In-page destinations for long forms. Anchors keep browser history and keyboard focus. */
export function SectionLinks({
	items,
	label = "On this page",
}: {
	items: { id: string; label: string; detail?: string }[];
	label?: string;
}) {
	return (
		<nav aria-label={label} className="fieldwork-section-links">
			{items.map((item) => (
				<a key={item.id} href={`#${item.id}`} className="group min-w-0">
					<span className="flex items-center justify-between gap-3 text-sm font-medium">
						{item.label}
						<ArrowDown
							aria-hidden="true"
							className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5 motion-reduce:transform-none"
						/>
					</span>
					{item.detail && (
						<span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
							{item.detail}
						</span>
					)}
				</a>
			))}
		</nav>
	);
}
