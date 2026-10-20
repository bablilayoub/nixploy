import { brandingAccentCss, publicBranding } from "@nixploy/server/modules/branding/index";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { BrandingProvider } from "@/components/branding-provider";

import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-jetbrains-mono",
});

/**
 * Resolved per render rather than a constant, so an operator who renames the
 * product sees it in the browser tab and the favicon too — the two places a
 * whitelabel is most obviously missing when it stops at the header.
 */
export async function generateMetadata(): Promise<Metadata> {
	const branding = await publicBranding();
	return {
		title: {
			default: branding.productName,
			template: `%s | ${branding.productName}`,
		},
		description: branding.customised
			? `${branding.productName} — deploy applications and databases on your own infrastructure.`
			: "Nixploy — a free, self-hostable PaaS. Deploy applications and databases with Docker Swarm and Traefik.",
		icons: {
			icon: [
				branding.faviconUrl
					? { url: branding.faviconUrl }
					: { url: "/brand/nixploy-mark-light.png", type: "image/png" },
			],
			apple: [{ url: "/apple-icon.png", type: "image/png" }],
		},
	};
}

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const branding = await publicBranding();
	const accentCss = brandingAccentCss(branding.accentColor);
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/*
				 * The instance accent, then operator CSS — in that order, so a
				 * stylesheet can override the tokens. The accent is generated from a
				 * validated hex colour; the CSS is sanitised on save
				 * (`modules/branding/css.ts`).
				 */}
				{accentCss ? (
					// biome-ignore lint/security/noDangerouslySetInnerHtml: a <style> child must not be HTML-escaped; the value is generated from a hex-validated colour
					<style dangerouslySetInnerHTML={{ __html: accentCss }} />
				) : null}
				{branding.customCss ? (
					// biome-ignore lint/security/noDangerouslySetInnerHtml: a <style> child must not be HTML-escaped, and the value is sanitised on save
					<style dangerouslySetInnerHTML={{ __html: branding.customCss }} />
				) : null}
			</head>
			<body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
				<BrandingProvider branding={branding}>
					<Providers>{children}</Providers>
				</BrandingProvider>
			</body>
		</html>
	);
}
