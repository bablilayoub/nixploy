"use client";
import { Tabs } from "radix-ui";
import type { ReactNode } from "react";
export function TraceTabs({
	items,
}: {
	items: { id: string; label: string; content: ReactNode }[];
}) {
	return (
		<Tabs.Root defaultValue={items[0]?.id} className="mt-14">
			<div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b">
				<Tabs.List aria-label="Agent workflows" className="flex flex-wrap gap-5">
					{items.map((item) => (
						<Tabs.Trigger
							key={item.id}
							value={item.id}
							className="min-h-12 border-b-2 border-transparent px-1 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary"
						>
							{item.label}
						</Tabs.Trigger>
					))}
				</Tabs.List>
				<p className="pb-3 text-xs text-muted-foreground">
					Illustrative sessions · real MCP tool names
				</p>
			</div>
			{items.map((item) => (
				<Tabs.Content key={item.id} value={item.id}>
					{item.content}
				</Tabs.Content>
			))}
		</Tabs.Root>
	);
}
