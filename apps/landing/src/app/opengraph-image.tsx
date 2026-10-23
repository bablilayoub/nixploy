import { ImageResponse } from "next/og";

import { site } from "@/lib/site";

/*
 * The card every share of nixploy.com shows.
 *
 * It used to be a 1200×1200 PNG of the mark alone — the wrong aspect for Open
 * Graph, so it was cropped by most clients, and it said nothing about what the
 * product is. Generated here instead: right size, on the site's palette, and
 * it cannot drift from the copy because it reads `site`.
 */
export const alt = "Nixploy — a platform as a service you host yourself";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				background: "#0c0c0c",
				backgroundImage:
					"radial-gradient(60% 70% at 25% 0%, rgba(255,255,255,0.10), transparent 70%)",
				padding: 72,
				color: "#fafafa",
				fontFamily: "sans-serif",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
				<div
					style={{
						width: 44,
						height: 44,
						borderRadius: 12,
						background: "#fafafa",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "#0c0c0c",
						fontSize: 26,
						fontWeight: 700,
					}}
				>
					N
				</div>
				<div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{site.name}</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
				<div
					style={{
						fontSize: 78,
						fontWeight: 700,
						letterSpacing: -2.5,
						lineHeight: 1.05,
						display: "flex",
						flexDirection: "column",
					}}
				>
					<span>Ship anything.</span>
					<span style={{ color: "#a1a1a1" }}>Own everything.</span>
				</div>
				<div style={{ fontSize: 30, color: "#b4b4b4", maxWidth: 900, lineHeight: 1.4 }}>
					A platform as a service that runs on your own box. Git deploys, Compose stacks, databases,
					domains with TLS, backups and monitoring.
				</div>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					fontSize: 24,
					color: "#8f8f8f",
					borderTop: "1px solid rgba(255,255,255,0.14)",
					paddingTop: 28,
				}}
			>
				<span>nixploy.com</span>
				<span>Apache-2.0 · self-hosted</span>
			</div>
		</div>,
		size,
	);
}
