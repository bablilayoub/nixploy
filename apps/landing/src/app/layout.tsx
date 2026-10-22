import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MotionProvider } from "@/components/motion-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { site } from "@/lib/site";
import "./globals.css";

const inter = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
	display: "swap",
});
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',t!=='light'&&(t!=='system'||matchMedia('(prefers-color-scheme: dark)').matches))}catch(e){document.documentElement.classList.add('dark')}})()`;

/*
 * Motion writes its `initial` state as an inline style, so every reveal on the
 * site renders at `opacity: 0` in the server HTML and stays there when scripts
 * do not run. This is the one rule that makes the page readable without them.
 */
const NOSCRIPT_REVEAL =
	"[style*='opacity:0']{opacity:1!important;transform:none!important;filter:none!important}";

export const metadata: Metadata = {
	metadataBase: new URL(site.url),
	title: {
		default: "Nixploy — Self-hostable PaaS for applications & databases",
		template: `%s · ${site.name}`,
	},
	description: site.description,
	alternates: { canonical: "/" },
	icons: {
		icon: [{ url: "/brand/nixploy-mark-light.png", type: "image/png" }],
		apple: [{ url: "/apple-icon.png", type: "image/png" }],
	},
	openGraph: {
		title: "Nixploy — From your code. To your cloud.",
		description: site.description,
		url: site.url,
		siteName: site.name,
		type: "website",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "Nixploy — From your code. To your cloud.",
		description: site.description,
	},
	robots: { index: true, follow: true },
};

export const viewport: Viewport = {
	// Matches `--background` in globals.css (oklch(0.145 0 0)); a theme colour
	// that is not the page colour shows as a seam in the browser chrome.
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
		{ media: "(prefers-color-scheme: dark)", color: "#0b0d11" },
	],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: fixed theme bootstrap contains no external input. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
				{/*
				 * Motion writes its `initial` state as an inline style, so every
				 * reveal on the site renders at `opacity: 0` in the server HTML
				 * and stays there when scripts do not run. This is the one rule
				 * that makes the page readable without them.
				 */}
				<noscript>
					<style>{NOSCRIPT_REVEAL}</style>
				</noscript>
			</head>
			<body className="bg-background font-sans text-foreground antialiased">
				<ThemeProvider>
					<MotionProvider>{children}</MotionProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
