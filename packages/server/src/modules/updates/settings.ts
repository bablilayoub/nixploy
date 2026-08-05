import { eq } from "drizzle-orm";
import { db } from "../../db";
import { webServerSettings } from "../../db/schema";

/** Nested under metricsConfig.webServer — no migration required. */
const EXTRAS_KEY = "webServer";

export interface UpdateSettings {
	/** Periodically check GHCR for a newer image digest (default true). */
	autoCheckEnabled: boolean;
	/** When a newer digest is found, pull & roll the service (default false). */
	autoUpdateEnabled: boolean;
	/** Cron for automatic checks (default every 6 hours). */
	checkCron: string;
	/** Image ref to track (default ghcr.io/bablilayoub/nixploy:latest). */
	image: string;
	lastCheckedAt: string | null;
	lastUpdateAt: string | null;
	lastError: string | null;
	updateInProgress: boolean;
	/** Last known remote digest from a successful check. */
	latestDigest: string | null;
	/** Last known running digest from a successful check. */
	currentDigest: string | null;
	updateAvailable: boolean;
}

export const DEFAULT_UPDATE_IMAGE = "ghcr.io/bablilayoub/nixploy:latest";
export const DEFAULT_CHECK_CRON = "17 */6 * * *";

const defaults: UpdateSettings = {
	autoCheckEnabled: true,
	autoUpdateEnabled: false,
	checkCron: DEFAULT_CHECK_CRON,
	image: DEFAULT_UPDATE_IMAGE,
	lastCheckedAt: null,
	lastUpdateAt: null,
	lastError: null,
	updateInProgress: false,
	latestDigest: null,
	currentDigest: null,
	updateAvailable: false,
};

function readExtras(metricsConfig: unknown): Record<string, unknown> {
	if (typeof metricsConfig === "object" && metricsConfig !== null) {
		const extras = (metricsConfig as Record<string, unknown>)[EXTRAS_KEY];
		if (typeof extras === "object" && extras !== null) {
			return extras as Record<string, unknown>;
		}
	}
	return {};
}

function asBool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string | null): string | null {
	if (typeof value === "string" && value.trim()) return value.trim();
	return fallback;
}

export function parseUpdateSettings(metricsConfig: unknown): UpdateSettings {
	const extras = readExtras(metricsConfig);
	return {
		autoCheckEnabled: asBool(extras.autoCheckEnabled, defaults.autoCheckEnabled),
		autoUpdateEnabled: asBool(extras.autoUpdateEnabled, defaults.autoUpdateEnabled),
		checkCron: asString(extras.updateCheckCron, defaults.checkCron) ?? defaults.checkCron,
		image:
			asString(extras.updateImage, process.env.NIXPLOY_IMAGE ?? defaults.image) ?? defaults.image,
		lastCheckedAt: asString(extras.updateLastCheckedAt, null),
		lastUpdateAt: asString(extras.updateLastUpdateAt, null),
		lastError: asString(extras.updateLastError, null),
		updateInProgress: asBool(extras.updateInProgress, false),
		latestDigest: asString(extras.updateLatestDigest, null),
		currentDigest: asString(extras.updateCurrentDigest, null),
		updateAvailable: asBool(extras.updateAvailable, false),
	};
}

export async function getUpdateSettings(): Promise<UpdateSettings> {
	const [row] = await db.select().from(webServerSettings).limit(1);
	return parseUpdateSettings(row?.metricsConfig);
}

export async function patchUpdateSettings(patch: Partial<UpdateSettings>): Promise<UpdateSettings> {
	const [existing] = await db.select().from(webServerSettings).limit(1);
	const current = parseUpdateSettings(existing?.metricsConfig);
	const next: UpdateSettings = { ...current, ...patch };

	const base =
		typeof existing?.metricsConfig === "object" && existing.metricsConfig !== null
			? (existing.metricsConfig as Record<string, unknown>)
			: {};
	const extras = {
		...readExtras(existing?.metricsConfig),
		autoCheckEnabled: next.autoCheckEnabled,
		autoUpdateEnabled: next.autoUpdateEnabled,
		updateCheckCron: next.checkCron,
		updateImage: next.image,
		updateLastCheckedAt: next.lastCheckedAt,
		updateLastUpdateAt: next.lastUpdateAt,
		updateLastError: next.lastError,
		updateInProgress: next.updateInProgress,
		updateLatestDigest: next.latestDigest,
		updateCurrentDigest: next.currentDigest,
		updateAvailable: next.updateAvailable,
	};
	const metricsConfig = { ...base, [EXTRAS_KEY]: extras };

	if (existing) {
		await db
			.update(webServerSettings)
			.set({ metricsConfig })
			.where(eq(webServerSettings.webServerSettingsId, existing.webServerSettingsId));
	} else {
		await db.insert(webServerSettings).values({ metricsConfig });
	}
	return next;
}
