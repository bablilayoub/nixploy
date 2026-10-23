"use client";

import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface FocusSection {
	id: string;
	label: string;
	detail?: string;
	aliases?: string[];
}

/** Related tasks share a work area. Panels stay mounted so section switches never discard a draft. */
export function FocusSections({
	items,
	children,
	label = "Configuration sections",
	className,
}: {
	items: FocusSection[];
	children: ReactNode;
	label?: string;
	className?: string;
}) {
	const first = items[0]?.id ?? "";
	const [selected, setSelected] = useState(first);
	useEffect(() => {
		const read = () => {
			const fragment = window.location.hash.slice(1);
			const match = items.find((item) => item.id === fragment || item.aliases?.includes(fragment));
			setSelected(match?.id ?? first);
		};
		read();
		window.addEventListener("hashchange", read);
		window.addEventListener("popstate", read);
		return () => {
			window.removeEventListener("hashchange", read);
			window.removeEventListener("popstate", read);
		};
	}, [items, first]);
	const select = (value: string) => {
		setSelected(value);
		const url = new URL(window.location.href);
		url.hash = value;
		window.history.replaceState(window.history.state, "", url);
	};
	const panels = Children.toArray(children).filter(isValidElement) as ReactElement<{
		id?: string;
	}>[];
	return (
		<Tabs
			value={selected}
			onValueChange={select}
			activationMode="manual"
			className={cn("focus-sections min-w-0 gap-6", className)}
		>
			<div className="sm:hidden">
				<Select value={selected} onValueChange={select}>
					<SelectTrigger className="w-full" aria-label={label}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{items.map((item) => (
							<SelectItem key={item.id} value={item.id}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<TabsList
				aria-label={label}
				className="hidden h-auto min-h-11 gap-1 rounded-lg bg-transparent p-0 sm:inline-flex"
			>
				{items.map((item) => (
					<TabsTrigger
						key={item.id}
						value={item.id}
						className="h-auto min-h-10 flex-none rounded-lg px-3 py-2 text-sm data-[state=active]:bg-secondary data-[state=active]:shadow-none dark:data-[state=active]:border-transparent"
					>
						{item.label}
					</TabsTrigger>
				))}
			</TabsList>
			{items.map((item) => (
				<TabsContent
					key={item.id}
					value={item.id}
					forceMount
					hidden={selected !== item.id}
					className="mt-0 data-[state=inactive]:hidden"
				>
					{panels.find((panel) => panel.props.id === item.id)}
				</TabsContent>
			))}
		</Tabs>
	);
}
