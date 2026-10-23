/*
 * Brand marks for the template catalogue, served by simple-icons' CDN.
 *
 * Marks whose own colour is within a few percent of black would vanish on
 * this page, so they are asked for in the foreground colour; every other mark
 * keeps its own.
 */
const DARK_MARKS = new Set([
	"ghost",
	"vaultwarden",
	"ollama",
	"caldotcom",
	"directus",
	"umami",
	"outline",
	"appsmith",
	"coder",
	"github",
	"mariadb",
	"mysql",
	"nextdotjs",
	"vercel",
]);

/** simple-icons slug in the project's own colour, or an absolute URL the catalogue already carries. */
export function brandIconSrc(logo: string) {
	if (logo.startsWith("http")) return logo;
	return DARK_MARKS.has(logo)
		? `https://cdn.simpleicons.org/${logo}/f4f4f5`
		: `https://cdn.simpleicons.org/${logo}`;
}
