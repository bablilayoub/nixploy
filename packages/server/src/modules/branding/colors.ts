/** Import-free so the server-rendered instance theme and client org theme agree. */
function relativeLuminance(hex: string): number {
	const channel = (offset: number) => {
		const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string) {
	const first = relativeLuminance(a);
	const second = relativeLuminance(b);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function brandPalette(accent: string | null | undefined, dark: boolean) {
	if (!accent || !/^#[0-9A-Fa-f]{6}$/.test(accent)) return null;
	const foreground =
		contrast(accent, "#000000") > contrast(accent, "#ffffff") ? "#000000" : "#ffffff";
	const surfaces = dark ? ["#15171c", "#1d2027"] : ["#f7f8fa", "#ffffff"];
	let link = accent;
	// Retain hue while finding readable link text on both workspace surfaces.
	for (
		let step = 1;
		step <= 100 && surfaces.some((surface) => contrast(link, surface) < 4.5);
		step++
	) {
		link = `#${[1, 3, 5]
			.map((offset) => {
				const original = Number.parseInt(accent.slice(offset, offset + 2), 16);
				return Math.round(original + (((dark ? 255 : 0) - original) * step) / 100)
					.toString(16)
					.padStart(2, "0");
			})
			.join("")}`;
	}
	return {
		fill: accent,
		foreground,
		hover: `color-mix(in srgb, ${accent} 90%, ${foreground === "#000000" ? "#ffffff" : "#000000"})`,
		link,
	};
}
