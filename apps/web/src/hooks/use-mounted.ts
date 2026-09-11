"use client";

import { useEffect, useState } from "react";

/**
 * `false` on the server and for the first client render, `true` afterwards.
 *
 * Gate anything that cannot match the server output (theme-dependent icons,
 * `Intl`/locale formatting, `window` reads, portals) behind it so hydration
 * stays warning-free. Replaces the hand-rolled
 * `const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), [])`
 * that used to sit in a dozen components.
 */
export function useMounted(): boolean {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return mounted;
}
