/**
 * Sanitize a `?next=` redirect target so the auth pages never bounce the
 * browser to another origin. Anything that is not a plain in-app path falls
 * back to the dashboard.
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
		raw.includes("@") ||
		!/^\/[A-Za-z0-9._~/-]*$/.test(raw)
	) {
		return "/dashboard";
	}
	return raw;
}
