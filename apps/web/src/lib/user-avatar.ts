/**
 * Profile avatar helpers — preset marks (inline SVG) and Gravatar.
 * Values stored on better-auth `user.image`:
 * - `preset:<id>` — curated SVG mark
 * - `gravatar:` — resolve from email at display time
 * - absolute URL — used as-is (legacy)
 * - null/empty — initials fallback
 */

export type PresetAvatar = {
	id: string;
	label: string;
	/** data:image/svg+xml URL */
	src: string;
};

function svgDataUri(svg: string): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
}

function blobAvatar(bg: string, accent: string, seed: number): string {
	const cx = 20 + (seed % 5) * 3;
	const cy = 18 + ((seed * 3) % 7);
	return svgDataUri(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
			<rect width="64" height="64" rx="32" fill="${bg}"/>
			<circle cx="${cx}" cy="${cy}" r="18" fill="${accent}" opacity="0.9"/>
			<circle cx="${64 - cx}" cy="${48 - cy / 2}" r="14" fill="${accent}" opacity="0.55"/>
			<path d="M8 52c8-14 20-18 32-12s16 18 16 24H8z" fill="${accent}" opacity="0.35"/>
		</svg>
	`);
}

/** Curated avatar marks the user can pick in Profile settings. */
export const PRESET_AVATARS: PresetAvatar[] = [
	{ id: "coral", label: "Coral", src: blobAvatar("#F97316", "#FED7AA", 1) },
	{ id: "amber", label: "Amber", src: blobAvatar("#EAB308", "#FEF08A", 2) },
	{ id: "lime", label: "Lime", src: blobAvatar("#84CC16", "#D9F99D", 3) },
	{ id: "teal", label: "Teal", src: blobAvatar("#14B8A6", "#99F6E4", 4) },
	{ id: "sky", label: "Sky", src: blobAvatar("#0EA5E9", "#BAE6FD", 5) },
	{ id: "indigo", label: "Indigo", src: blobAvatar("#6366F1", "#C7D2FE", 6) },
	{ id: "violet", label: "Violet", src: blobAvatar("#8B5CF6", "#DDD6FE", 7) },
	{ id: "rose", label: "Rose", src: blobAvatar("#F43F5E", "#FECDD3", 8) },
	{ id: "stone", label: "Stone", src: blobAvatar("#78716C", "#E7E5E4", 9) },
	{ id: "slate", label: "Slate", src: blobAvatar("#475569", "#CBD5E1", 10) },
];

const PRESET_BY_ID = new Map(PRESET_AVATARS.map((preset) => [preset.id, preset]));

export const PRESET_IMAGE_PREFIX = "preset:";
/** Marker stored in `user.image` when the user opts into Gravatar. */
export const GRAVATAR_IMAGE_MARKER = "gravatar:";

export function presetImageValue(id: string): string {
	return `${PRESET_IMAGE_PREFIX}${id}`;
}

export function isPresetImage(image: string | null | undefined): boolean {
	return Boolean(image?.startsWith(PRESET_IMAGE_PREFIX));
}

export function isGravatarImage(image: string | null | undefined): boolean {
	if (!image) return false;
	return image === GRAVATAR_IMAGE_MARKER || image.startsWith("https://www.gravatar.com/avatar/");
}

export async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** Gravatar URL for an email (SHA-256). Falls back to an identicon when unset. */
export async function gravatarUrl(email: string, size = 128): Promise<string> {
	const hash = await sha256Hex(email.trim().toLowerCase());
	return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon&r=pg`;
}

/**
 * Resolve what to show for a user. Preset/gravatar markers are expanded;
 * absolute URLs pass through.
 */
export async function resolveUserImageSrc(
	image: string | null | undefined,
	email: string | null | undefined,
	size = 128,
): Promise<string | null> {
	if (!image) return null;
	if (image.startsWith(PRESET_IMAGE_PREFIX)) {
		const preset = PRESET_BY_ID.get(image.slice(PRESET_IMAGE_PREFIX.length));
		return preset?.src ?? null;
	}
	if (image === GRAVATAR_IMAGE_MARKER) {
		if (!email) return null;
		return gravatarUrl(email, size);
	}
	return image;
}

export function userInitials(name?: string | null, email?: string | null): string {
	const source = (name || email || "?").trim();
	return source
		.split(/\s+/)
		.map((part) => part.charAt(0).toUpperCase())
		.slice(0, 2)
		.join("");
}
