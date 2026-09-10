import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, JetBrains_Mono, Syne } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

const syne = Syne({
	subsets: ["latin"],
	variable: "--font-syne",
	display: "swap",
});

const plex = IBM_Plex_Sans({
	subsets: ["latin"],
	weight: ["400", "500", "600"],
	variable: "--font-plex",
	display: "swap",
});

const mono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
	display: "swap",
});

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
		title: "Nixploy — Ship anything. Own everything.",
		description: site.description,
		url: site.url,
		siteName: site.name,
		type: "website",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "Nixploy — Ship anything. Own everything.",
		description: site.description,
	},
	robots: { index: true, follow: true },
};

export const viewport: Viewport = {
	themeColor: "#0a0b0e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`dark ${syne.variable} ${plex.variable} ${mono.variable}`}>
			<body className="bg-background font-sans text-foreground antialiased">{children}</body>
		</html>
	);
}
