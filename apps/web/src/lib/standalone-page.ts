import "server-only";

/**
 * A complete HTML document with no app shell.
 *
 * The forward-auth routes render outside the dashboard — one of them on a
 * tenant's own hostname — so they cannot use the panel's layout, its fonts or
 * its theme provider. Everything is inlined, the palette follows the viewer's
 * system theme, and every interpolated value is escaped because the reasons
 * these pages show include a hostname the caller supplied.
 */
const escapeHtml = (value: string): string =>
	value.replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
			character,
	);

export function standalonePage(status: number, title: string, body: string): Response {
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8">` +
			`<meta name="viewport" content="width=device-width,initial-scale=1">` +
			`<meta name="robots" content="noindex">` +
			`<title>${escapeHtml(title)}</title><style>` +
			`:root{color-scheme:light dark}` +
			`body{margin:0;min-height:100svh;display:grid;place-items:center;background:#fafafa;color:#171717;` +
			`font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}` +
			`@media(prefers-color-scheme:dark){body{background:#0a0a0a;color:#fafafa}main{border-color:#262626}}` +
			`main{max-width:32rem;padding:2rem;border:1px solid #e5e5e5;border-radius:.75rem;margin:1rem}` +
			`h1{margin:0 0 .5rem;font-size:1.05rem;font-weight:600}p{margin:0;opacity:.75}` +
			`</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`,
		{ status, headers: { "content-type": "text/html; charset=utf-8" } },
	);
}
