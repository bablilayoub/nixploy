import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfigDir } from "../deployment/paths";
import { badRequest, notFound } from "../errors";

/**
 * Uploaded source-panel dumps live under `<config>/imports/<org>/<id>` with
 * a small sidecar, mode 0600, for at most {@link DUMP_TTL_MS}: a dump holds
 * the other panel's whole database, so it is scoped to the organisation that
 * uploaded it and swept by the maintenance pass rather than kept.
 */

export const MAX_DUMP_BYTES = 512 * 1024 * 1024;
export const DUMP_TTL_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^[a-f0-9]{24}$/;
const ORG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type DumpFormat = "plain" | "custom";

export interface StoredDump {
	dumpId: string;
	organizationId: string;
	filename: string;
	bytes: number;
	format: DumpFormat;
	gzipped: boolean;
	uploadedAt: string;
}

export const getImportsDir = (): string => path.join(getConfigDir(), "imports");

const orgDir = (organizationId: string): string => {
	if (!ORG_RE.test(organizationId)) throw badRequest("Invalid organisation id");
	return path.join(getImportsDir(), organizationId);
};

const dumpPath = (organizationId: string, dumpId: string): string => {
	if (!ID_RE.test(dumpId)) throw badRequest("Invalid dump id");
	return path.join(orgDir(organizationId), dumpId);
};

/**
 * `pg_dump` plain SQL starts with `--` comments (or `SET`), the custom
 * format with `PGDMP`; either may be gzipped. Anything else is refused
 * before it is written: a dump is fed to `psql`/`pg_restore` later, and an
 * arbitrary file there is an arbitrary file inside a container.
 */
export function sniffDump(head: Buffer): { format: DumpFormat; gzipped: boolean } {
	const gzipped = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
	if (gzipped) return { format: "plain", gzipped: true };
	if (head.subarray(0, 5).toString("latin1") === "PGDMP")
		return { format: "custom", gzipped: false };
	const text = head.subarray(0, 512).toString("utf8");
	if (/^\s*(--|SET |SELECT pg_catalog|\\restrict|CREATE |BEGIN)/.test(text)) {
		return { format: "plain", gzipped: false };
	}
	throw badRequest(
		"Not a PostgreSQL dump: expected pg_dump plain SQL (optionally gzipped) or the custom format",
	);
}

export async function storeDump(
	organizationId: string,
	filename: string,
	body: Buffer,
): Promise<StoredDump> {
	if (body.length === 0) throw badRequest("The dump is empty");
	if (body.length > MAX_DUMP_BYTES) {
		throw badRequest(`The dump exceeds ${MAX_DUMP_BYTES / 1024 / 1024} MiB`);
	}
	const { format, gzipped } = sniffDump(body.subarray(0, 512));
	const dumpId = randomBytes(12).toString("hex");
	const dir = dumpPath(organizationId, dumpId);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await writeFile(path.join(dir, "dump"), body, { mode: 0o600 });
	const meta: StoredDump = {
		dumpId,
		organizationId,
		filename: filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "dump",
		bytes: body.length,
		format,
		gzipped,
		uploadedAt: new Date().toISOString(),
	};
	await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
	return meta;
}

export async function readDumpMeta(organizationId: string, dumpId: string): Promise<StoredDump> {
	const dir = dumpPath(organizationId, dumpId);
	try {
		const raw = await readFile(path.join(dir, "meta.json"), "utf8");
		return JSON.parse(raw) as StoredDump;
	} catch {
		throw notFound("Dump not found (uploads expire after 24 hours)");
	}
}

export const dumpFilePath = (organizationId: string, dumpId: string): string =>
	path.join(dumpPath(organizationId, dumpId), "dump");

export async function removeDump(organizationId: string, dumpId: string): Promise<void> {
	await rm(dumpPath(organizationId, dumpId), { recursive: true, force: true });
}

/** Drop uploads older than the TTL — the hourly maintenance pass calls this. */
export async function pruneImportDumps(now = Date.now()): Promise<number> {
	let removed = 0;
	let orgs: string[];
	try {
		orgs = await readdir(getImportsDir());
	} catch {
		return 0;
	}
	for (const org of orgs) {
		const dir = path.join(getImportsDir(), org);
		let ids: string[];
		try {
			ids = await readdir(dir);
		} catch {
			continue;
		}
		for (const id of ids) {
			const info = await stat(path.join(dir, id, "meta.json")).catch(() => null);
			if (!info) continue;
			if (now - info.mtimeMs > DUMP_TTL_MS) {
				await rm(path.join(dir, id), { recursive: true, force: true });
				removed += 1;
			}
		}
	}
	return removed;
}
