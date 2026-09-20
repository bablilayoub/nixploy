import { X509Certificate } from "node:crypto";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "../../db";
import { certificates } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";
import { notifyEvent } from "../notifications";
import { recordIncident } from "../observability";

const log = createLogger("certificate-expiry");

/**
 * Expiry tracking for manually uploaded TLS certificates.
 *
 * These are PEMs somebody pasted in; Nixploy did not issue them and cannot
 * renew them (Let's Encrypt certificates are Traefik's business and renew
 * themselves). What it *can* do is read `notAfter` and say something before
 * the certificate lapses, which is the difference between a scheduled swap
 * and an outage.
 *
 * The column this replaced was `auto_renew`: a toggle with no consumer, and
 * one that could never have had one.
 */

/** How far ahead a certificate starts warning. */
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `notAfter` of the **leaf** certificate in a PEM chain, or null when the
 * blob cannot be parsed.
 *
 * Null rather than throwing on purpose: a chain Node's parser dislikes is an
 * upload Traefik may still be perfectly happy with, and refusing the upload
 * over a date we only wanted for a warning would be the tail wagging the dog.
 * The convention (and what `writeCertificateFiles` assumes) is leaf first.
 */
export function parseCertificateExpiry(pem: string): Date | null {
	try {
		// `new X509Certificate` reads the FIRST certificate of a chain, which is
		// the leaf — the intermediates outlive it and would report a later date.
		const parsed = new X509Certificate(pem);
		const validTo = new Date(parsed.validTo);
		return Number.isNaN(validTo.getTime()) ? null : validTo;
	} catch {
		return null;
	}
}

/** Whole days until `expiresAt`; negative once it has lapsed. */
export const daysUntil = (expiresAt: Date, now = new Date()): number =>
	Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);

/** The line a warning shows, for an expiry that is near or already past. */
export function describeExpiry(name: string, expiresAt: Date, now = new Date()): string {
	const days = daysUntil(expiresAt, now);
	if (days < 0) {
		return `Certificate "${name}" expired ${Math.abs(days)} day(s) ago (${expiresAt.toISOString()}). Traefik is serving an invalid certificate for every domain using it.`;
	}
	if (days === 0) {
		return `Certificate "${name}" expires today (${expiresAt.toISOString()}). Upload a renewed chain.`;
	}
	return `Certificate "${name}" expires in ${days} day(s) (${expiresAt.toISOString()}). Upload a renewed chain before then.`;
}

/**
 * Fill `expires_at` for rows that have none.
 *
 * Migration 0035 added the column but SQL cannot parse a PEM, and every
 * certificate uploaded before this feature existed therefore has NULL — which
 * would silently exclude exactly the oldest (and likeliest to be expiring)
 * certificates from the warning. Runs on each maintenance pass and converges
 * after one; a chain that cannot be parsed stays NULL and is retried, which
 * costs one `X509Certificate` construction an hour and keeps the door open for
 * a parser that learns the format later.
 */
export async function backfillCertificateExpiry(): Promise<number> {
	const rows = await db.query.certificates.findMany({
		where: isNull(certificates.expiresAt),
		columns: { certificateId: true, certificateData: true },
	});
	let filled = 0;
	for (const row of rows) {
		const expiresAt = parseCertificateExpiry(row.certificateData);
		if (!expiresAt) continue;
		await db
			.update(certificates)
			.set({ expiresAt })
			.where(eq(certificates.certificateId, row.certificateId));
		filled += 1;
	}
	if (filled > 0) log.info(`Backfilled the expiry of ${filled} certificate(s)`);
	return filled;
}

/**
 * Warn about certificates inside the window.
 *
 * Runs from the hourly maintenance pass. Re-warning every hour would be noise,
 * so the incident is recorded once per certificate per day — `recordIncident`
 * has no dedupe of its own, and an operator who has seen it needs the next
 * reminder tomorrow, not in sixty minutes.
 */
export async function warnAboutExpiringCertificates(now = new Date()): Promise<number> {
	await backfillCertificateExpiry();
	const cutoff = new Date(now.getTime() + CERTIFICATE_EXPIRY_WARNING_DAYS * DAY_MS);
	const rows = await db.query.certificates.findMany({
		where: and(
			eq(certificates.expiryAlerts, true),
			isNotNull(certificates.expiresAt),
			lte(certificates.expiresAt, cutoff),
		),
		columns: {
			certificateId: true,
			name: true,
			expiresAt: true,
			organizationId: true,
		},
	});

	let warned = 0;
	for (const row of rows) {
		if (!row.expiresAt) continue;
		if (await warnedToday(row.certificateId, now)) continue;
		const days = daysUntil(row.expiresAt, now);
		const message = describeExpiry(row.name, row.expiresAt, now);
		try {
			await recordIncident({
				organizationId: row.organizationId,
				kind: "certificate_expiry",
				severity: days <= 0 ? "critical" : "warning",
				title: days < 0 ? `Certificate expired: ${row.name}` : `Certificate expiring: ${row.name}`,
				message,
				serviceName: row.name,
				metadata: {
					certificateId: row.certificateId,
					expiresAt: row.expiresAt.toISOString(),
					daysRemaining: days,
				},
			});
			await notifyEvent(row.organizationId, "certificateExpiry", {
				title: days < 0 ? `Certificate expired: ${row.name}` : `Certificate expiring: ${row.name}`,
				message,
				fields: [
					{ name: "Certificate", value: row.name },
					{ name: "Expires", value: row.expiresAt.toISOString() },
					{ name: "Days left", value: String(days) },
				],
			});
			warned += 1;
		} catch (error) {
			log.error(`Failed to warn about certificate ${row.name}`, {
				error: describeErrorWithCause(error),
			});
		}
	}
	if (warned > 0) log.info(`Warned about ${warned} expiring certificate(s)`);
	return warned;
}

/** Has this certificate already produced an incident in the last 24 hours? */
async function warnedToday(certificateId: string, now: Date): Promise<boolean> {
	const { incidents } = await import("../../db/schema");
	const { gte, sql } = await import("drizzle-orm");
	const since = new Date(now.getTime() - DAY_MS);
	const existing = await db.query.incidents.findFirst({
		where: and(
			eq(incidents.kind, "certificate_expiry"),
			gte(incidents.createdAt, since),
			sql`${incidents.metadata}->>'certificateId' = ${certificateId}`,
		),
		columns: { incidentId: true },
	});
	return Boolean(existing);
}
