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
	rail = false,
}: {
	items: FocusSection[];
	children: ReactNode;
	label?: string;
	className?: string;
	rail?: boolean;
}) {
	const [desktop, setDesktop] = useState(false);
	useEffect(() => {
		const media = window.matchMedia("(min-width: 1024px)");
		const update = () => setDesktop(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
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
			orientation={rail && desktop ? "vertical" : "horizontal"}
			value={selected}
			onValueChange={select}
			activationMode="manual"
			className={cn(
				"focus-sections min-w-0 gap-6",
				rail && "lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-start",
				className,
			)}
		>
			<div className={rail ? "lg:hidden" : "sm:hidden"}>
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
				className={cn(
					"hidden h-auto sm:inline-flex",
					rail &&
						"sm:hidden lg:flex lg:min-h-fit lg:w-full lg:flex-col lg:items-stretch lg:sticky lg:top-[calc(var(--app-chrome-height,112px)+2rem)]",
				)}
			>
				{items.map((item) => (
					<TabsTrigger
						key={item.id}
						value={item.id}
						className={cn(
							"flex-none",
							rail && "lg:h-auto lg:min-h-10 lg:justify-start lg:whitespace-normal lg:text-left",
						)}
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
					className={cn(
						"mt-0 data-[state=inactive]:hidden",
						rail && "lg:col-start-2 lg:row-start-1",
					)}
				>
					{panels.find((panel) => panel.props.id === item.id)}
				</TabsContent>
			))}
		</Tabs>
	);
}
