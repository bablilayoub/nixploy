"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTRPC } from "@/lib/trpc";

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** sRGB relative luminance, for picking readable text on the accent. */
function luminance(hex: string): number {
	const channel = (value: number) => {
		const c = value / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const r = channel(Number.parseInt(hex.slice(1, 3), 16));
	const g = channel(Number.parseInt(hex.slice(3, 5), 16));
	const b = channel(Number.parseInt(hex.slice(5, 7), 16));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Applies the organization accent colour (UX audit F34). Scope is deliberate
 * and documented in the branding card: primary buttons (`--primary`, with a
 * readable foreground derived from the accent's luminance — otherwise a pale
 * accent renders white-on-white) and the active tab underline (`--brand`).
 * The rest of the panel stays monochrome on purpose.
 */
export function OrgBrandingProvider({ children }: { children: React.ReactNode }) {
	const trpc = useTRPC();
	const { data } = useQuery(trpc.organization.settings.queryOptions());
	const accent = data?.branding?.accentColor;

	useEffect(() => {
		const root = document.documentElement;
		const clear = () => {
			root.style.removeProperty("--primary");
			root.style.removeProperty("--primary-foreground");
			root.style.removeProperty("--brand");
			delete root.dataset.brand;
		};
		if (!accent || !HEX.test(accent)) {
			clear();
			return;
		}
		root.style.setProperty("--primary", accent);
		root.style.setProperty(
			"--primary-foreground",
			luminance(accent) > 0.45 ? "#1c1917" : "#fafafa",
		);
		root.style.setProperty("--brand", accent);
		root.dataset.brand = "custom";
		return clear;
	}, [accent]);

	return children;
}
