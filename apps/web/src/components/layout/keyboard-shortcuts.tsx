"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

const NAV_SHORTCUTS: { keys: string[]; label: string; href: string }[] = [
	{ keys: ["g", "d"], label: "Go to Dashboard", href: "/dashboard" },
	{ keys: ["g", "p"], label: "Go to Projects", href: "/dashboard" },
	{ keys: ["g", "t"], label: "Go to Templates", href: "/dashboard/templates" },
	{ keys: ["g", "m"], label: "Go to Monitoring", href: "/dashboard/monitoring" },
	{ keys: ["g", "s"], label: "Go to Settings", href: "/dashboard/settings" },
];

const isTypingTarget = (target: EventTarget | null) => {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
};

function Key({ children }: { children: React.ReactNode }) {
	return <kbd className="rounded border bg-secondary px-1 font-mono text-[10px]">{children}</kbd>;
}

/**
 * Global keyboard shortcuts: `?` opens this overlay, `g <key>` navigates.
 * Ignored while typing in inputs/contenteditable; ⌘K stays with the palette.
 */
export function KeyboardShortcuts() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const pendingG = useRef<number | null>(null);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
				pendingG.current = null;
				return;
			}

			if (event.key === "?") {
				event.preventDefault();
				setOpen((value) => !value);
				pendingG.current = null;
				return;
			}

			const now = Date.now();
			if (event.key.toLowerCase() === "g") {
				pendingG.current = now;
				return;
			}

			if (pendingG.current && now - pendingG.current < 1000) {
				const shortcut = NAV_SHORTCUTS.find((entry) => entry.keys[1] === event.key.toLowerCase());
				if (shortcut) {
					event.preventDefault();
					router.push(shortcut.href);
				}
			}
			pendingG.current = null;
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [router]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>
						Navigate the dashboard without leaving the keyboard.
					</DialogDescription>
				</DialogHeader>
				<ul className="flex flex-col gap-2.5">
					{NAV_SHORTCUTS.map((shortcut) => (
						<li key={shortcut.label} className="flex items-center justify-between gap-4 text-sm">
							<span>{shortcut.label}</span>
							<span className="flex items-center gap-1">
								{shortcut.keys.map((key) => (
									<Key key={key}>{key}</Key>
								))}
							</span>
						</li>
					))}
					<li className="flex items-center justify-between gap-4 text-sm">
						<span>Command palette</span>
						<span className="flex items-center gap-1">
							<Key>⌘</Key>
							<Key>K</Key>
						</span>
					</li>
					<li className="flex items-center justify-between gap-4 text-sm">
						<span>Toggle this overlay</span>
						<span className="flex items-center gap-1">
							<Key>?</Key>
						</span>
					</li>
				</ul>
			</DialogContent>
		</Dialog>
	);
}
