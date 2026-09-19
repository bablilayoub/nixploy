import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

/*
 * Three faces: Space Grotesk for headings (the display token — angular like
 * the mark, and not the house font of a hosting company), Geist for body,
 * Geist Mono for terminals and code. `h1`–`h3` take the display face through
 * a base rule in globals.css, so no heading needs a class for it.
 */
const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist",
	display: "swap",
});

const spaceGrotesk = Space_Grotesk({
	subsets: ["latin"],
	variable: "--font-space-grotesk",
	display: "swap",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
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
	themeColor: "#08080a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			lang="en"
			className={`dark ${geist.variable} ${spaceGrotesk.variable} ${geistMono.variable}`}
		>
			<body className="bg-background font-sans text-foreground antialiased">{children}</body>
		</html>
	);
}
