"use client";

import { useEffect, useState } from "react";

/**
 * Trails `value` by `delay` ms so a query keyed on it does not fire on every
 * keystroke. The first value is returned immediately; every later change
 * restarts the timer.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debounced;
}
