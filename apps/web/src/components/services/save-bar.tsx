"use client";

import { CircleDot, Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
	createContext,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

/**
 * One registered form on the current tab. The bar only ever shows entries
 * that are dirty; `save` / `discard` are re-read from a ref so the registry
 * does not have to churn on every keystroke.
 */
interface SaveBarEntry {
	dirty: boolean;
	pending: boolean;
	disabled: boolean;
	save: () => void;
	discard: () => void;
}

interface SaveBarRegistry {
	set: (id: string, entry: SaveBarEntry) => void;
	remove: (id: string) => void;
	subscribe: (listener: () => void) => () => void;
	snapshot: () => SaveBarEntry[];
}

const SaveBarContext = createContext<SaveBarRegistry | null>(null);

function useRegistry(): SaveBarRegistry {
	const entries = useRef(new Map<string, SaveBarEntry>());
	const listeners = useRef(new Set<() => void>());
	const cache = useRef<SaveBarEntry[]>([]);

	return useMemo<SaveBarRegistry>(() => {
		const emit = () => {
			cache.current = [...entries.current.values()];
			for (const listener of listeners.current) listener();
		};
		return {
			set(id, entry) {
				entries.current.set(id, entry);
				emit();
			},
			remove(id) {
				if (entries.current.delete(id)) emit();
			},
			subscribe(listener) {
				listeners.current.add(listener);
				return () => {
					listeners.current.delete(listener);
				};
			},
			snapshot: () => cache.current,
		};
	}, []);
}

/**
 * Sticky "Unsaved changes — Save / Discard" bar for one tab (UX audit F12).
 *
 * Mount it around one screen's worth of forms — a service page's tab content
 * (`SaveBarTabsContent`) or the settings layout's page slot. Both unmount
 * what the user navigated away from, so the registry only ever holds the
 * forms currently on screen. Forms opt in with `useSaveBar(draft, …)`; a form
 * that does not opt in still keeps its own Save button and the navigation
 * guard from `useDraft`.
 */
export function SaveBarProvider({ children }: { children: ReactNode }) {
	const registry = useRegistry();
	return (
		<SaveBarContext.Provider value={registry}>
			{children}
			<SaveBar registry={registry} />
		</SaveBarContext.Provider>
	);
}

/**
 * `TabsContent` with its own save bar — the shape every service detail page
 * uses for a top-level tab. Radix unmounts the inactive tabs, so each tab's
 * registry only ever holds its own forms and the bar disappears with them.
 */
export function SaveBarTabsContent({
	children,
	...props
}: ComponentProps<typeof TabsContent>): ReactNode {
	return (
		<TabsContent {...props}>
			<SaveBarProvider>{children}</SaveBarProvider>
		</TabsContent>
	);
}

function SaveBar({ registry }: { registry: SaveBarRegistry }) {
	// The registry owns the data and hands out a stable array per change, so
	// an external store is cheaper than mirroring entries into React state.
	const entries = useSyncExternalStore(registry.subscribe, registry.snapshot, registry.snapshot);
	const dirty = entries.filter((entry) => entry.dirty);
	if (dirty.length === 0) return null;

	const pending = dirty.some((entry) => entry.pending);
	const blocked = dirty.every((entry) => entry.disabled);
	const label =
		dirty.length === 1 ? "Unsaved changes" : `Unsaved changes in ${dirty.length} sections`;

	return (
		<div
			className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4"
			role="status"
		>
			<div className="bg-background/95 pointer-events-auto flex items-center gap-3 rounded-lg border border-border px-4 py-2 shadow-lg backdrop-blur">
				<CircleDot className="size-4 text-warning" aria-hidden />
				<span className="text-sm text-foreground">{label}</span>
				<Button
					variant="outline"
					size="sm"
					disabled={pending}
					onClick={() => {
						for (const entry of dirty) entry.discard();
					}}
				>
					Discard
				</Button>
				<Button
					size="sm"
					disabled={pending || blocked}
					onClick={() => {
						for (const entry of dirty) {
							if (!entry.disabled) entry.save();
						}
					}}
				>
					{pending && <Loader2 className="size-4 animate-spin" />}
					Save
				</Button>
			</div>
		</div>
	);
}

/**
 * Register a draft with the tab's save bar. No-ops outside a
 * `SaveBarProvider`, so a form can be reused on pages that have no bar.
 */
export function useSaveBar(
	draft: { dirty: boolean; reset: () => void },
	options: { onSave: () => void; pending?: boolean; disabled?: boolean },
): void {
	const registry = useContext(SaveBarContext);
	const id = useId();
	const latest = useRef({ draft, options });
	latest.current = { draft, options };

	const dirty = draft.dirty;
	const pending = options.pending ?? false;
	const disabled = options.disabled ?? false;

	useEffect(() => {
		if (!registry) return;
		registry.set(id, {
			dirty,
			pending,
			disabled,
			save: () => latest.current.options.onSave(),
			discard: () => latest.current.draft.reset(),
		});
		return () => registry.remove(id);
	}, [registry, id, dirty, pending, disabled]);
}
