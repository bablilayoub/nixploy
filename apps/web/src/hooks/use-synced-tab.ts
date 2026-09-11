"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { confirmDiscardUnsavedChanges } from "@/hooks/use-unsaved-changes";

/**
 * Retired service-page tab ids → their replacement in the unified tab order
 * (UX audit F8). Deep links minted before the sprint keep working:
 * `?tab=config` used to be the Environment + Advanced group, both of which
 * are now top-level, so it lands on Environment.
 */
export const SERVICE_TAB_ALIASES: Record<string, string> = {
	config: "environment",
};

/**
 * Syncs a tab selection to the `?tab=` query param so detail-page tabs are
 * deep-linkable (mirrors the project page's tab sync). The value may be a
 * top-level tab or a nested sub-tab — callers derive which is which.
 * `isValid` rejects unknown param values; selecting the default tab removes
 * the param. A `?tab=` change from outside (same-route navigation, browser
 * back/forward) re-syncs the selected value.
 *
 * Nested tab sets that live under a `?tab=` group (e.g. Advanced →
 * Mounts/Ports/…) pass their own `param` so both levels stay in the URL
 * (`?tab=advanced&advanced=swarm`).
 *
 * `aliases` rewrites a retired tab id to its replacement before validation,
 * so links shared before an IA change keep landing on the right tab.
 *
 * Switching unmounts the previous `TabsContent`, so a dirty form there would
 * lose its edits: `select` first asks through the unsaved-changes guard.
 */
export function useSyncedTab(
	defaultValue: string,
	isValid?: (value: string) => boolean,
	options: { param?: string; aliases?: Record<string, string> } = {},
) {
	const paramName = options.param ?? "tab";
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const raw = searchParams.get(paramName);
	const param = raw ? (options.aliases?.[raw] ?? raw) : raw;
	const resolved = param && (!isValid || isValid(param)) ? param : defaultValue;
	const [value, setValue] = useState(resolved);

	useEffect(() => {
		setValue(resolved);
	}, [resolved]);

	const select = useCallback(
		(next: string) => {
			if (next !== value && !confirmDiscardUnsavedChanges()) return;
			setValue(next);
			const params = new URLSearchParams(searchParams.toString());
			if (next === defaultValue) {
				params.delete(paramName);
			} else {
				params.set(paramName, next);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
		},
		[defaultValue, paramName, pathname, router, searchParams, value],
	);

	return [value, select] as const;
}
