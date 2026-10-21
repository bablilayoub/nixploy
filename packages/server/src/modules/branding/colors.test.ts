import { describe, expect, it } from "vitest";
import { brandPalette } from "./colors";

// Independent WCAG calculation: verify the rendered pairs, not adjustment steps.
function ratio(a: string, b: string) {
	const luminance = (value: string) => {
		const channels =
			value
				.slice(1)
				.match(/../g)
				?.map((part) => {
					const channel = Number.parseInt(part, 16) / 255;
					return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
				}) ?? [];
		return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
	};
	const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe("saved brand contrast", () => {
	it("preserves the saved fill and readable links/actions across both themes", () => {
		for (const red of [0, 51, 102, 153, 204, 255]) {
			for (const green of [0, 51, 102, 153, 204, 255]) {
				for (const blue of [0, 51, 102, 153, 204, 255]) {
					const saved = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
					for (const dark of [false, true]) {
						const palette = brandPalette(saved, dark);
						expect(palette?.fill).toBe(saved);
						if (!palette) throw new Error("Valid saved accent rejected");
						expect(ratio(palette.fill, palette.foreground)).toBeGreaterThanOrEqual(4.5);
						for (const surface of dark ? ["#15171c", "#1d2027"] : ["#f7f8fa", "#ffffff"]) {
							expect(ratio(palette.link, surface)).toBeGreaterThanOrEqual(4.5);
						}
					}
				}
			}
		}
	});

	it("falls back for missing, malformed or CSS-bearing values", () => {
		for (const saved of [null, undefined, "", "red", "#fff", "#123456; color:red", "#zzzzzz"]) {
			expect(brandPalette(saved, false)).toBeNull();
			expect(brandPalette(saved, true)).toBeNull();
		}
	});
});
