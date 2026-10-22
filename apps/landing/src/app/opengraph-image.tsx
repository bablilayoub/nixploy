import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { heroLead, heroTitle } from "@/lib/landing-data";
import { site } from "@/lib/site";

export const alt = "Nixploy — a platform as a service you host yourself";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share card follows Fieldwork and uses the same product copy as the site. */
export default async function OpengraphImage() {
	const mark = await readFile(join(process.cwd(), "public/brand/nixploy-mark-dark.png"));
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				background: "#0b0d11",
				padding: 64,
				color: "#f4f5f7",
				fontFamily: "sans-serif",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
				{/* ImageResponse consumes the embedded bytes; this is not a browser image. */}
				{/* biome-ignore lint/performance/noImgElement: Satori requires an img element. */}
				<img
					src={`data:image/png;base64,${mark.toString("base64")}`}
					width={44}
					height={44}
					alt=""
				/>
				<span style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.6 }}>{site.name}</span>
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						fontSize: 76,
						fontWeight: 600,
						letterSpacing: -3.5,
						lineHeight: 1.05,
					}}
				>
					<span>{heroTitle[0]}</span>
					<span style={{ color: "#ff895c" }}>{heroTitle[1]}</span>
				</div>
				<div style={{ fontSize: 26, color: "#a9b2c0", maxWidth: 940, lineHeight: 1.5 }}>
					{heroLead}
				</div>
			</div>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					fontSize: 22,
					color: "#a9b2c0",
					borderTop: "1px solid #2b313c",
					paddingTop: 24,
				}}
			>
				<span>nixploy.com</span>
				<span>Open source · Self-hosted</span>
			</div>
		</div>,
		size,
	);
}
