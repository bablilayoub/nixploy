"use client";

import { brandPalette } from "@nixploy/server/modules/branding/colors";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect } from "react";

import { useTRPC } from "@/lib/trpc";

/** Preserve the saved fill; derive readable action text and theme-aware links. */
export function OrgBrandingProvider({ children }: { children: React.ReactNode }) {
	const trpc = useTRPC();
	const { data } = useQuery(trpc.organization.settings.queryOptions());
	const { resolvedTheme } = useTheme();
	const accent = data?.branding?.accentColor;

	useEffect(() => {
		const root = document.documentElement;
		const clear = () => {
			for (const property of ["--primary", "--primary-foreground", "--primary-hover", "--brand"])
				root.style.removeProperty(property);
			delete root.dataset.brand;
		};
		const palette = brandPalette(accent, resolvedTheme === "dark");
		if (!palette) {
			clear();
			return;
		}
		root.style.setProperty("--primary", palette.fill);
		root.style.setProperty("--primary-foreground", palette.foreground);
		root.style.setProperty("--primary-hover", palette.hover);
		root.style.setProperty("--brand", palette.link);
		root.dataset.brand = "custom";
		return clear;
	}, [accent, resolvedTheme]);

	return children;
}
