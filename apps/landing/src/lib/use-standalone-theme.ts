"use client";

import { useLayoutEffect } from "react";

/** Last-resort pages replace the root layout and must not need its providers. */
export function useStandaloneTheme(fallback: "light" | "system" = "light") {
	useLayoutEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			let preference: string | null = fallback;
			try {
				preference = localStorage.getItem("theme") ?? fallback;
			} catch {
				/* OS/default still works without storage. */
			}
			const dark = preference === "dark" || (preference === "system" && media.matches);
			document.documentElement.classList.toggle("dark", dark);
			document.documentElement.classList.toggle("light", !dark);
		};
		apply();
		media.addEventListener("change", apply);
		window.addEventListener("storage", apply);
		return () => {
			media.removeEventListener("change", apply);
			window.removeEventListener("storage", apply);
		};
	}, [fallback]);
}
