import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_CSS_BYTES, sanitiseCustomCss } from "./css";

describe("sanitiseCustomCss", () => {
	it("leaves ordinary CSS alone", () => {
		const css = ".panel-logo { height: 28px; margin-inline: 4px; }";
		expect(sanitiseCustomCss(css)).toBe(css);
	});

	it("strips @import, which would pull in a stylesheet nobody reviewed", () => {
		expect(sanitiseCustomCss('@import url("https://evil.test/x.css"); a { color: red }')).toBe(
			"a { color: red }",
		);
	});

	it("defuses the declaration-level script vectors", () => {
		for (const css of [
			"a { width: expression(alert(1)) }",
			"a { -moz-binding: url(https://evil.test/x.xml#e) }",
			"a { behavior: url(#default#time2) }",
		]) {
			const out = sanitiseCustomCss(css);
			expect(out, css).not.toMatch(/expression\s*\(|-moz-binding|behavior\s*:/i);
		}
	});

	it("removes a javascript: url without removing ordinary urls", () => {
		expect(sanitiseCustomCss("a { background: url(javascript:alert(1)) }")).toContain("url()");
		const ok = "a { background: url(/api/branding/logo-1.png) }";
		expect(sanitiseCustomCss(ok)).toBe(ok);
	});

	it("removes anything that could close the style element", () => {
		// The value is rendered as a text node, so this cannot introduce markup —
		// but leaving it makes a stored stylesheet hard to reason about.
		expect(sanitiseCustomCss("a{} </style><script>alert(1)</script>")).not.toContain("</style");
		expect(sanitiseCustomCss("a{} <!-- x --> b{}")).not.toContain("<!--");
	});

	it("is case- and whitespace-insensitive about the constructs it removes", () => {
		expect(sanitiseCustomCss("a { WIDTH: EXPRESSION (alert(1)) }")).not.toMatch(/EXPRESSION\s*\(/i);
		expect(sanitiseCustomCss("@IMPORT 'x.css';")).toBe("");
	});

	it("caps the stored stylesheet", () => {
		expect(sanitiseCustomCss("a".repeat(MAX_CUSTOM_CSS_BYTES + 5000)).length).toBeLessThanOrEqual(
			MAX_CUSTOM_CSS_BYTES,
		);
	});
});
