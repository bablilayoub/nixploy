/**
 * Cookie helpers for client-side UI state (e.g. sidebar collapse).
 * Prefer document.cookie over a dependency for a single boolean flag.
 */

const DEFAULT_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function getCookie(name: string): string | undefined {
	if (typeof document === "undefined") return undefined;
	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) {
		return parts.pop()?.split(";").shift();
	}
	return undefined;
}

export function setCookie(name: string, value: string, maxAge: number = DEFAULT_MAX_AGE): void {
	if (typeof document === "undefined") return;
	// biome-ignore lint/suspicious/noDocumentCookie: sidebar collapse persistence; Cookie Store API not universal
	document.cookie = `${name}=${value}; path=/; max-age=${maxAge}`;
}

export function removeCookie(name: string): void {
	if (typeof document === "undefined") return;
	// biome-ignore lint/suspicious/noDocumentCookie: sidebar collapse persistence; Cookie Store API not universal
	document.cookie = `${name}=; path=/; max-age=0`;
}
