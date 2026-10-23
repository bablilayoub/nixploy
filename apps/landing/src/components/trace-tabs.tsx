"use client";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
export function TraceTabs({
	items,
}: {
	items: { id: string; label: string; content: ReactNode }[];
}) {
	return (
		<Tabs defaultValue={items[0]?.id} className="mt-14">
			<div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b">
				<TabsList aria-label="Agent workflows" className="flex flex-wrap gap-5">
					{items.map((item) => (
						<TabsTrigger
							key={item.id}
							value={item.id}
							className="min-h-12 border-b-2 border-transparent px-1 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary"
						>
							{item.label}
						</TabsTrigger>
					))}
				</TabsList>
				<p className="pb-3 text-xs text-muted-foreground">
					Illustrative sessions · real MCP tool names
				</p>
			</div>
			{items.map((item) => (
				<TabsContent key={item.id} value={item.id}>
					{item.content}
				</TabsContent>
			))}
		</Tabs>
	);
}
