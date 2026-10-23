"use client";
import { ArrowUpRight, Search, X } from "lucide-react";
import Link from "next/link";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { docsNav } from "@/lib/docs/nav";

const entries = docsNav.flatMap((group) =>
	group.items.map((item) => ({ ...item, group: group.title })),
);
export function DocsSearch() {
	const [open, setOpen] = useState(false),
		[query, setQuery] = useState("");
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (
				event.key.toLowerCase() === "k" &&
				(event.metaKey || event.ctrlKey) &&
				!(
					event.target instanceof HTMLElement &&
					(event.target.isContentEditable ||
						["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
				)
			) {
				event.preventDefault();
				setOpen((value) => !value);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	const results = entries.filter((item) =>
		`${item.label} ${item.group}`.toLowerCase().includes(query.trim().toLowerCase()),
	);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(value) => {
				setOpen(value);
				if (!value) setQuery("");
			}}
		>
			<Dialog.Trigger className="signal-search-trigger" aria-label="Search documentation">
				<Search className="size-4" aria-hidden="true" />
				<span className="hidden xl:inline">Search docs</span>
				<kbd className="hidden xl:inline">⌘ K</kbd>
			</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" />
				<Dialog.Content className="signal-search-dialog">
					<Dialog.Title className="sr-only">Search documentation</Dialog.Title>
					<Dialog.Description className="sr-only">
						Find installation, deployment and operations guides.
					</Dialog.Description>
					<div className="flex items-center gap-3 border-b p-5">
						<Search className="size-5 shrink-0 text-primary" aria-hidden="true" />
						<Input
							aria-label="Search documentation pages"
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="What are you building?"
							className="min-h-11 min-w-0 flex-1 rounded-sm bg-transparent text-base focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
						/>
						<Dialog.Close className="signal-icon-button" aria-label="Close search">
							<X className="size-4" />
						</Dialog.Close>
					</div>
					<div className="max-h-[60svh] overflow-y-auto p-2">
						<p className="px-3 py-2 text-xs text-muted-foreground" role="status">
							{results.length} guides
						</p>
						{results.length ? (
							results.map((item) => (
								<Link
									key={item.href}
									href={item.href}
									onClick={() => setOpen(false)}
									className="signal-search-result"
								>
									<span>
										<span className="block text-sm font-medium">{item.label}</span>
										<span className="text-xs text-muted-foreground">{item.group}</span>
									</span>
									<ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
								</Link>
							))
						) : (
							<p className="px-3 py-8 text-sm text-muted-foreground">
								No guides match “{query}”. Try deploy, backups or install.
							</p>
						)}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
