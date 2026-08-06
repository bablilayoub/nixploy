"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTRPC } from "@/lib/trpc";

/** Applies organization accent color as --primary for white-label theming. */
export function OrgBrandingProvider({ children }: { children: React.ReactNode }) {
	const trpc = useTRPC();
	const { data } = useQuery(trpc.organization.settings.queryOptions());

	useEffect(() => {
		const root = document.documentElement;
		const accent = data?.branding?.accentColor;
		if (accent && /^#[0-9A-Fa-f]{6}$/.test(accent)) {
			root.style.setProperty("--primary", accent);
		} else {
			root.style.removeProperty("--primary");
		}
		return () => {
			root.style.removeProperty("--primary");
		};
	}, [data?.branding?.accentColor]);

	return children;
}
