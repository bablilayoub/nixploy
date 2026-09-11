"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { confirmDiscardUnsavedChanges } from "@/hooks/use-unsaved-changes";

/**
 * Syncs a tab selection to the `?tab=` query param so detail-page tabs are
 * deep-linkable (mirrors the project page's tab sync). The value may be a
 * top-level tab or a nested sub-tab — callers derive which is which.
 * `isValid` rejects unknown param values; selecting the default tab removes
 * the param. A `?tab=` change from outside (same-route navigation, browser
 * back/forward) re-syncs the selected value.
 *
 * Switching unmounts the previous `TabsContent`, so a dirty form there would
 * lose its edits: `select` first asks through the unsaved-changes guard.
 */
export function useSyncedTab(defaultValue: string, isValid?: (value: string) => boolean) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const param = searchParams.get("tab");
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
				params.delete("tab");
			} else {
				params.set("tab", next);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
		},
		[defaultValue, pathname, router, searchParams, value],
	);

	return [value, select] as const;
}
