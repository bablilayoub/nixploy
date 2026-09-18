import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));

import { detectImageKind, isSafeAssetName, sanitiseSvg } from "./index";

const withMagic = (magic: number[]): Buffer => Buffer.from([...magic, 0, 1, 2, 3, 4, 5, 6, 7]);

describe("detectImageKind", () => {
	it("identifies the raster formats by their magic bytes", () => {
		expect(detectImageKind(withMagic([0x89, 0x50, 0x4e, 0x47]))?.extension).toBe("png");
		expect(detectImageKind(withMagic([0xff, 0xd8, 0xff]))?.extension).toBe("jpg");
		expect(detectImageKind(withMagic([0x47, 0x49, 0x46, 0x38]))?.extension).toBe("gif");
		expect(detectImageKind(withMagic([0x52, 0x49, 0x46, 0x46]))?.extension).toBe("webp");
		expect(detectImageKind(withMagic([0x00, 0x00, 0x01, 0x00]))?.extension).toBe("ico");
	});

	it("identifies an SVG by its root element, with or without a prologue", () => {
		expect(
			detectImageKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))?.extension,
		).toBe("svg");
		expect(detectImageKind(Buffer.from('<?xml version="1.0"?><svg/>'))?.extension).toBe("svg");
		expect(detectImageKind(Buffer.from("   \n <svg/>"))?.extension).toBe("svg");
	});

	it("refuses a file whose name lies about what it is", () => {
		// The whole reason this reads bytes and not the browser's filename: an
		// HTML document served back from the panel's own origin is stored XSS.
		expect(detectImageKind(Buffer.from("<html><body>hi</body></html>"))).toBeNull();
		expect(detectImageKind(Buffer.from("#!/bin/sh\necho hi"))).toBeNull();
		expect(detectImageKind(Buffer.from("just some text"))).toBeNull();
		expect(detectImageKind(Buffer.from(""))).toBeNull();
	});
});

describe("sanitiseSvg", () => {
	it("removes script elements", () => {
		expect(sanitiseSvg("<svg><script>alert(1)</script><rect/></svg>")).toBe("<svg><rect/></svg>");
	});

	it("removes event handlers however they are quoted", () => {
		for (const svg of [
			'<svg onload="alert(1)"><rect/></svg>',
			"<svg onload='alert(1)'><rect/></svg>",
			"<svg onload=alert(1)><rect/></svg>",
		]) {
			expect(sanitiseSvg(svg), svg).not.toMatch(/onload/i);
		}
	});

	it("removes the elements that can pull in or execute something else", () => {
		const out = sanitiseSvg(
			'<svg><foreignObject><iframe src="x"/></foreignObject><use href="#a"/></svg>',
		);
		expect(out).not.toMatch(/foreignObject|iframe|<use/i);
	});

	it("removes a javascript: href but keeps an ordinary one", () => {
		expect(sanitiseSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).not.toContain(
			"javascript:",
		);
		expect(sanitiseSvg('<svg><a href="https://example.com">x</a></svg>')).toContain(
			"https://example.com",
		);
	});

	it("keeps the drawing", () => {
		const svg = '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#fff"/></svg>';
		expect(sanitiseSvg(svg)).toBe(svg);
	});
});

describe("isSafeAssetName", () => {
	it("accepts the names the uploader generates", () => {
		expect(isSafeAssetName("logoLight-1a2b3c4d.png")).toBe(true);
		expect(isSafeAssetName("favicon-00000000.ico")).toBe(true);
	});

	it("refuses anything that could escape the branding directory", () => {
		// This is what stands between a request for the URL and `<config>/.env`.
		for (const name of ["../.env", "..%2f.env", "a/../../x", "/etc/passwd", "", ".hidden"]) {
			expect(isSafeAssetName(name), name).toBe(false);
		}
	});
});
