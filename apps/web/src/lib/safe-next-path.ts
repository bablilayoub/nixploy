/**
 * Sanitize a `?next=` redirect target so the auth pages never bounce the
 * browser to another origin. Anything that is not a plain in-app path falls
 * back to the dashboard.
 *
 * A single query string is preserved — service pages carry their tab in one
 * (`/dashboard/projects/x?tab=domains`), and dropping it used to land the user
 * on the dashboard after signing in. The alphabet stays deliberately narrow:
 * no `%` (encoded separators are how open redirects get smuggled in), no `#`,
 * no second `?`.
 */
export function safeNextPath(raw: string | null | undefined): string {
	if (!raw) return "/dashboard";
	// Block open redirects: protocol-relative, backslash tricks, encoded separators.
	if (
		!raw.startsWith("/") ||
		raw.startsWith("//") ||
		raw.includes("\\") ||
		raw.includes("%2f") ||
		raw.includes("%2F") ||
		raw.includes("%5c") ||
		raw.includes("%5C") ||
		raw.includes("@")
	) {
		return "/dashboard";
	}
	const queryAt = raw.indexOf("?");
	const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
	const query = queryAt === -1 ? "" : raw.slice(queryAt + 1);
	if (!/^\/[A-Za-z0-9._~/-]*$/.test(path)) return "/dashboard";
	if (query && !/^[A-Za-z0-9._~=&-]*$/.test(query)) return "/dashboard";
	return raw;
}
