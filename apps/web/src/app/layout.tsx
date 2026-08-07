import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
	title: {
		default: "Nixploy",
		template: "%s | Nixploy",
	},
	description:
		"Nixploy — a free, self-hostable PaaS. Deploy applications and databases with Docker Swarm and Traefik.",
	icons: {
		icon: [{ url: "/brand/nixploy-mark-light.png", type: "image/png" }],
		apple: [{ url: "/apple-icon.png", type: "image/png" }],
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
