import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../db";
import { instanceBranding } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { getConfigDir } from "../application/paths";
import { badRequest, payloadTooLarge } from "../errors";
import { sanitiseCustomCss } from "./css";

const log = createLogger("branding");

/**
 * Instance whitelabel: the product name, logos, favicon, accent and the bits
 * of copy an operator wants to be theirs.
 *
 * Free, because the panels that charge for it charge for a text field and an
 * image upload. The interesting parts are all in what an uploaded file is
 * allowed to be.
 */

/** Uploaded branding assets live here, beside the rest of the instance state. */
export const getBrandingDir = (): string => path.join(getConfigDir(), "branding");

/** One row, or none. */
export type InstanceBrandingRow = typeof instanceBranding.$inferSelect;

/** What the panel renders. Never includes a path — only the asset's URL. */
export interface PublicBranding {
	productName: string;
	accentColor: string | null;
	logoLightUrl: string | null;
	logoDarkUrl: string | null;
	faviconUrl: string | null;
	footerText: string | null;
	supportUrl: string | null;
	docsUrl: string | null;
	customCss: string | null;
	/** True when an operator has actually configured something. */
	customised: boolean;
}

export const DEFAULT_PRODUCT_NAME = "Nixploy";

/**
 * Cached because it is read on every page render, including the login page of
 * an instance nobody has signed in to. Cleared explicitly on save rather than
 * expired on a timer — an operator who changes a logo expects to see it.
 *
 * On `globalThis` for the usual reason: Next evaluates `packages/server` twice,
 * so a module-local cache would be invalidated in the copy that handled the
 * mutation while the copy that renders pages kept serving the old branding.
 */
const globalForBranding = globalThis as typeof globalThis & {
	__nixployBranding?: PublicBranding | null;
};

export function invalidateBrandingCache(): void {
	globalForBranding.__nixployBranding = null;
}

const assetUrl = (file: string | null): string | null =>
	file ? `/api/branding/${encodeURIComponent(file)}` : null;

export function toPublicBranding(row: InstanceBrandingRow | null | undefined): PublicBranding {
	return {
		productName: row?.productName?.trim() || DEFAULT_PRODUCT_NAME,
		accentColor: row?.accentColor ?? null,
		logoLightUrl: assetUrl(row?.logoLightFile ?? null),
		logoDarkUrl: assetUrl(row?.logoDarkFile ?? null),
		faviconUrl: assetUrl(row?.faviconFile ?? null),
		footerText: row?.footerText ?? null,
		supportUrl: row?.supportUrl ?? null,
		docsUrl: row?.docsUrl ?? null,
		customCss: row?.customCss ?? null,
		customised: Boolean(
			row &&
				(row.productName ||
					row.accentColor ||
					row.logoLightFile ||
					row.logoDarkFile ||
					row.faviconFile ||
					row.footerText ||
					row.customCss),
		),
	};
}

/** The row, or null. */
export async function loadInstanceBranding(): Promise<InstanceBrandingRow | null> {
	const [row] = await db.select().from(instanceBranding).limit(1);
	return row ?? null;
}

/**
 * Branding for rendering. Falls back to the defaults on any failure: a panel
 * that cannot read its own branding must still serve a login page.
 */
export async function publicBranding(): Promise<PublicBranding> {
	const cached = globalForBranding.__nixployBranding;
	if (cached) return cached;
	try {
		const fresh = toPublicBranding(await loadInstanceBranding());
		globalForBranding.__nixployBranding = fresh;
		return fresh;
	} catch (error) {
		log.error("Could not read instance branding", {
			error: error instanceof Error ? error.message : String(error),
		});
		return toPublicBranding(null);
	}
}

/**
 * sRGB relative luminance — the same calculation the per-organization accent
 * uses, so a pale brand colour does not render white-on-white.
 */
function luminance(hex: string): number {
	const channel = (value: number) => {
		const c = value / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return (
		0.2126 * channel(Number.parseInt(hex.slice(1, 3), 16)) +
		0.7152 * channel(Number.parseInt(hex.slice(3, 5), 16)) +
		0.0722 * channel(Number.parseInt(hex.slice(5, 7), 16))
	);
}

/**
 * The instance accent as CSS custom properties, or "".
 *
 * Emitted as a stylesheet rule rather than an inline style on the element, so
 * the per-organization accent — which `OrgBrandingProvider` sets inline at
 * runtime — still wins inside the dashboard. The instance colour is the
 * fallback, and the only one on the login and setup pages, which have no
 * organization to read.
 */
export function brandingAccentCss(accentColor: string | null | undefined): string {
	if (!accentColor || !/^#[0-9A-Fa-f]{6}$/.test(accentColor)) return "";
	const foreground = luminance(accentColor) > 0.45 ? "#1c1917" : "#fafafa";
	return `:root{--primary:${accentColor};--primary-foreground:${foreground};--brand:${accentColor};}`;
}

/* -------------------------------------------------------------------------- */
/*  Saving                                                                    */
/* -------------------------------------------------------------------------- */

export interface BrandingPatch {
	productName?: string | null;
	accentColor?: string | null;
	footerText?: string | null;
	supportUrl?: string | null;
	docsUrl?: string | null;
	emailFromName?: string | null;
	customCss?: string | null;
}

/** Upsert the singleton row. */
export async function saveInstanceBranding(patch: BrandingPatch): Promise<InstanceBrandingRow> {
	const values = {
		...patch,
		...(patch.customCss !== undefined
			? { customCss: patch.customCss ? sanitiseCustomCss(patch.customCss) : null }
			: {}),
		updatedAt: new Date(),
	};
	const existing = await loadInstanceBranding();
	const [row] = existing
		? await db.update(instanceBranding).set(values).returning()
		: await db.insert(instanceBranding).values(values).returning();
	invalidateBrandingCache();
	if (!row) throw new Error("Could not save branding");
	return row;
}

/* -------------------------------------------------------------------------- */
/*  Assets                                                                    */
/* -------------------------------------------------------------------------- */

export const BRANDING_ASSET_SLOTS = ["logoLight", "logoDark", "favicon"] as const;
export type BrandingAssetSlot = (typeof BRANDING_ASSET_SLOTS)[number];

const SLOT_COLUMNS: Record<BrandingAssetSlot, "logoLightFile" | "logoDarkFile" | "faviconFile"> = {
	logoLight: "logoLightFile",
	logoDark: "logoDarkFile",
	favicon: "faviconFile",
};

/** A logo is rendered at ~32px; a megabyte of PNG is already generous. */
export const MAX_BRANDING_ASSET_BYTES = 2 * 1024 * 1024;

interface ImageKind {
	extension: string;
	contentType: string;
	/** Leading bytes that identify the format. */
	magic?: number[];
}

/**
 * The formats a branding asset may be.
 *
 * Identified by **magic bytes**, not by the file name the browser sent: an
 * upload is attacker-controlled, and this file is later served back from the
 * panel's own origin. A `.png` that is actually HTML would be stored XSS.
 */
const IMAGE_KINDS: ImageKind[] = [
	{ extension: "png", contentType: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
	{ extension: "jpg", contentType: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
	{ extension: "gif", contentType: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] },
	{ extension: "webp", contentType: "image/webp", magic: [0x52, 0x49, 0x46, 0x46] },
	{ extension: "ico", contentType: "image/x-icon", magic: [0x00, 0x00, 0x01, 0x00] },
	// SVG has no magic number — it is XML, and it is handled separately because
	// it is the one format that can carry script.
	{ extension: "svg", contentType: "image/svg+xml" },
];

const startsWith = (bytes: Buffer, magic: number[]): boolean =>
	bytes.length >= magic.length && magic.every((value, index) => bytes[index] === value);

const looksLikeSvg = (bytes: Buffer): boolean => {
	const head = bytes.subarray(0, 1024).toString("utf8").trimStart().toLowerCase();
	return head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!doctype svg");
};

/** Which format an upload actually is, or null. */
export function detectImageKind(bytes: Buffer): ImageKind | null {
	for (const kind of IMAGE_KINDS) {
		if (kind.magic && startsWith(bytes, kind.magic)) return kind;
	}
	return looksLikeSvg(bytes)
		? (IMAGE_KINDS.find((kind) => kind.extension === "svg") ?? null)
		: null;
}

/**
 * Strip everything executable out of an SVG.
 *
 * An SVG is a document: it can carry `<script>`, `on*` handlers, `<foreignObject>`
 * and external references, and the panel serves this file from its own origin.
 * A denylist is not a proof of safety, which is why the asset route also sends
 * a restrictive `Content-Security-Policy` — this removes the obvious weapons
 * and the header covers what it misses.
 */
export function sanitiseSvg(svg: string): string {
	return svg
		.replace(/<script[\s\S]*?<\/script\s*>/gi, "")
		.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
		.replace(/<!ENTITY[\s\S]*?>/gi, "")
		.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
		.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
		.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
		.replace(/(href|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "")
		.replace(/<\s*(iframe|embed|object|use)\b[\s\S]*?>/gi, "");
}

/** Store an uploaded asset and point the slot at it. */
export async function saveBrandingAsset(
	slot: BrandingAssetSlot,
	bytes: Buffer,
): Promise<{ file: string; contentType: string }> {
	if (bytes.length === 0) throw badRequest("The uploaded file is empty");
	if (bytes.length > MAX_BRANDING_ASSET_BYTES) {
		throw payloadTooLarge(
			`Branding assets are limited to ${Math.round(MAX_BRANDING_ASSET_BYTES / 1024 / 1024)} MB`,
		);
	}
	const kind = detectImageKind(bytes);
	if (!kind) {
		throw badRequest("That file is not a PNG, JPEG, GIF, WebP, ICO or SVG image");
	}

	const payload =
		kind.extension === "svg" ? Buffer.from(sanitiseSvg(bytes.toString("utf8")), "utf8") : bytes;

	const directory = getBrandingDir();
	await mkdir(directory, { recursive: true });
	// A fresh name per upload, so a browser holding the previous logo in cache
	// cannot keep showing it.
	const file = `${slot}-${randomUUID().slice(0, 8)}.${kind.extension}`;
	await writeFile(path.join(directory, file), payload, { mode: 0o644 });

	const column = SLOT_COLUMNS[slot];
	const existing = await loadInstanceBranding();
	const previous = existing?.[column] ?? null;
	if (existing) {
		await db.update(instanceBranding).set({ [column]: file, updatedAt: new Date() });
	} else {
		await db.insert(instanceBranding).values({ [column]: file });
	}
	if (previous) await removeBrandingFile(previous);
	invalidateBrandingCache();
	return { file, contentType: kind.contentType };
}

/** Clear a slot and delete its file. */
export async function clearBrandingAsset(slot: BrandingAssetSlot): Promise<void> {
	const column = SLOT_COLUMNS[slot];
	const existing = await loadInstanceBranding();
	if (!existing?.[column]) return;
	await db.update(instanceBranding).set({ [column]: null, updatedAt: new Date() });
	await removeBrandingFile(existing[column] as string);
	invalidateBrandingCache();
}

async function removeBrandingFile(file: string): Promise<void> {
	if (!isSafeAssetName(file)) return;
	await rm(path.join(getBrandingDir(), file), { force: true }).catch(() => {});
}

/**
 * Whether a name may be resolved inside the branding directory.
 *
 * The stored value is generated by {@link saveBrandingAsset}, but the asset
 * route takes its name from the URL, so this is what stands between a request
 * for `../../.env` and the file.
 */
export function isSafeAssetName(name: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name) && !name.includes("..");
}

/** Read one asset back for the serving route. */
export async function readBrandingAsset(
	name: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
	if (!isSafeAssetName(name)) return null;
	const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
	const kind = IMAGE_KINDS.find((entry) => entry.extension === extension);
	if (!kind) return null;
	try {
		const bytes = await readFile(path.join(getBrandingDir(), name));
		return { bytes, contentType: kind.contentType };
	} catch {
		return null;
	}
}
