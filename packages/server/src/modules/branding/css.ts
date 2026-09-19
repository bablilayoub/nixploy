/**
 * Sanitising operator-supplied CSS.
 *
 * A whitelabel that cannot move a logo two pixels is not one, so the panel
 * accepts custom CSS — but it is injected into a page that renders tenant data
 * and holds a session, which makes "CSS" a bigger surface than it sounds:
 * `url(javascript:…)`, `expression()`, `@import` and `-moz-binding` have all
 * been script vectors, and `behavior:` still is in old engines.
 *
 * This removes those, and the tag itself cannot introduce markup because the
 * value is rendered as a text node, never as HTML. What remains is a
 * declaration language an operator can hurt their own panel's layout with,
 * which is their prerogative.
 *
 * Import-free and pure, so the rules are testable on their own.
 */

/** Longest stylesheet an operator may store. */
export const MAX_CUSTOM_CSS_BYTES = 64 * 1024;

/**
 * Constructs removed outright, with the reason each one is here:
 *
 * - `@import` — pulls a stylesheet from anywhere, which defeats the point of
 *   reviewing what was pasted.
 * - `expression(` — IE-era, executed JavaScript from a declaration.
 * - `behavior:` / `-moz-binding:` — attach script to an element.
 * - `javascript:` inside `url()` — the classic CSS script vector.
 * - `</style` — the only way a declaration could escape its own tag.
 */
const FORBIDDEN: Array<{ pattern: RegExp; replacement: string }> = [
	{ pattern: /@import[^;]*;?/gi, replacement: "" },
	{ pattern: /expression\s*\(/gi, replacement: "removed(" },
	{ pattern: /-moz-binding\s*:/gi, replacement: "removed:" },
	{ pattern: /\bbehavior\s*:/gi, replacement: "removed:" },
	{ pattern: /url\(\s*(['"]?)\s*javascript:[^)]*\)/gi, replacement: "url()" },
	{ pattern: /<\s*\/\s*style/gi, replacement: "" },
	// A `<` cannot start a tag here (the value is a text node), but leaving one
	// in makes a stylesheet that is hard to reason about when it is read back.
	{ pattern: /<!--|--!?>/g, replacement: "" },
];

/**
 * Sanitise and cap operator CSS. Returns the cleaned stylesheet; anything
 * removed is removed silently, because the alternative is refusing to save a
 * 300-line theme over one comment.
 */
export function sanitiseCustomCss(css: string): string {
	let out = css.slice(0, MAX_CUSTOM_CSS_BYTES);
	for (const { pattern, replacement } of FORBIDDEN) {
		out = out.replace(pattern, replacement);
	}
	return out.trim();
}
