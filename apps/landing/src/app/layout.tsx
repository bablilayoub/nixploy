import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist",
	display: "swap",
});

const mono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
	display: "swap",
});

export const metadata: Metadata = {
	metadataBase: new URL(site.url),
	title: {
		default: "Nixploy — Self-hostable PaaS for applications & databases",
		template: "%s · Nixploy",
	},
	description: site.description,
	alternates: { canonical: "/" },
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
	themeColor: "#050505",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`dark ${geist.variable} ${mono.variable}`}>
			<body className="bg-[#050505] font-sans text-white antialiased">{children}</body>
		</html>
	);
}
