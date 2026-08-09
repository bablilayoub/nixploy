"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

/**
 * Syncs a tab selection to the `?tab=` query param so detail-page tabs are
 * deep-linkable (mirrors the project page's tab sync). The value may be a
 * top-level tab or a nested sub-tab — callers derive which is which.
 * `isValid` rejects unknown param values; selecting the default tab removes
 * the param.
 */
export function useSyncedTab(defaultValue: string, isValid?: (value: string) => boolean) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [value, setValue] = useState(() => {
		const param = searchParams.get("tab");
		if (param && (!isValid || isValid(param))) {
			return param;
		}
		return defaultValue;
	});

	const select = useCallback(
		(next: string) => {
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
		[defaultValue, pathname, router, searchParams],
	);

	return [value, select] as const;
}
