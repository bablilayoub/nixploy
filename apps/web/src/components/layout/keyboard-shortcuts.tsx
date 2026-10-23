"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { docsUrl } from "@/components/ui/help-link";

/** Available everywhere in the dashboard. */
const NAV_SHORTCUTS: { key: string; label: string; href: string }[] = [
	{ key: "d", label: "Go to Docker", href: "/dashboard/docker" },
	{ key: "p", label: "Go to projects", href: "/dashboard" },
	{ key: "t", label: "Go to templates", href: "/dashboard/templates" },
	{ key: "m", label: "Go to monitoring", href: "/dashboard/monitoring" },
	{ key: "s", label: "Go to schedules", href: "/dashboard/schedules" },
	{ key: ",", label: "Go to settings", href: "/dashboard/settings" },
];

/**
 * Only on a service page: jump straight to one of its tabs. Tab ids are the
 * unified ones from the service-page sprint (UX audit F8/F15).
 */
const SERVICE_SHORTCUTS: { key: string; label: string; tab: string }[] = [
	{ key: "l", label: "Logs", tab: "logs" },
	{ key: "o", label: "Domains", tab: "domains" },
	{ key: "e", label: "Environment", tab: "environment" },
];

/** Databases have no Domains tab — `g o` is a no-op there. */
const SERVICE_ROUTE =
	/\/services\/(application|compose|postgres|mysql|mariadb|mongo|redis)\/[^/?]+/;
const DATABASE_ROUTE = /\/services\/(postgres|mysql|mariadb|mongo|redis)\/[^/?]+/;

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

function Row({ label, keys }: { label: string; keys: string[] }) {
	return (
		<li className="flex items-center justify-between gap-4 text-sm">
			<span>{label}</span>
			<span className="flex items-center gap-1">
				{keys.map((key) => (
					<Key key={key}>{key}</Key>
				))}
			</span>
		</li>
	);
}

/**
 * Global keyboard shortcuts: `?` opens this overlay, `g <key>` navigates.
 * On a service page `g l` / `g o` / `g e` open its Logs / Domains /
 * Environment tab (UX audit F15). Ignored while typing in
 * inputs/contenteditable; ⌘K stays with the palette.
 */
export function KeyboardShortcuts() {
	const router = useRouter();
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const pendingG = useRef<number | null>(null);
	// Read inside the handler without re-registering the listener on every route.
	const routeRef = useRef(pathname);
	routeRef.current = pathname;

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
				const key = event.key.toLowerCase();
				const route = routeRef.current;
				const onService = SERVICE_ROUTE.test(route);
				const serviceShortcut = onService
					? SERVICE_SHORTCUTS.find((entry) => entry.key === key)
					: undefined;
				if (serviceShortcut) {
					// Databases have no Domains tab; leave the page alone.
					if (!(serviceShortcut.tab === "domains" && DATABASE_ROUTE.test(route))) {
						event.preventDefault();
						router.push(`${route}?tab=${serviceShortcut.tab}`);
					}
					pendingG.current = null;
					return;
				}
				const shortcut = NAV_SHORTCUTS.find((entry) => entry.key === key);
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

	const onService = SERVICE_ROUTE.test(pathname);

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
						<Row key={shortcut.key} label={shortcut.label} keys={["g", shortcut.key]} />
					))}
					<li className="pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						On a service page
					</li>
					{SERVICE_SHORTCUTS.map((shortcut) => (
						<Row key={shortcut.key} label={shortcut.label} keys={["g", shortcut.key]} />
					))}
					{onService ? null : (
						<li className="text-xs text-muted-foreground">Open a service to use these three.</li>
					)}
					<Row label="Command palette" keys={["⌘", "K"]} />
					<Row label="Toggle this overlay" keys={["?"]} />
					<li className="flex items-center justify-between gap-4 text-sm">
						<span>Documentation</span>
						<a
							href={docsUrl()}
							target="_blank"
							rel="noreferrer noopener"
							className="font-medium text-foreground underline-offset-4 hover:underline"
						>
							nixploy.com/docs
						</a>
					</li>
				</ul>
			</DialogContent>
		</Dialog>
	);
}
