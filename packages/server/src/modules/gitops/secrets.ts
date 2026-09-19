import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { applications, compose, environments, projects } from "../../db/schema";
import { badRequest } from "../errors";
import { DATABASE_KINDS, type DatabaseServiceKind, databaseDef } from "../services/registry";
import type { EnvironmentGraph } from "./live";
import { envKeysFromDotenv } from "./schema";

/**
 * The secrets bundle: the values `nixploy.yaml` deliberately leaves out.
 *
 * A manifest carries env as key names only, so moving an environment to
 * another instance is two files — the manifest, and this bundle sealed
 * with a passphrase the operator types on both sides. The bundle holds the
 * env of the project, the environment and every service by name, plus an
 * application's build args and preview env (the three columns the panel
 * redacts behind `secrets.read`). Database passwords are not in it: the
 * running container was initialised with the stored one, and a row that
 * says otherwise would be a lie the next backup restore trips over.
 *
 * Format: `nixploy-secrets:1:<salt>:<iv>:<tag>:<ciphertext>` (all hex).
 * scrypt with a fresh 16-byte salt per bundle, AES-256-GCM with the prefix
 * as additional data, so a bundle cannot be re-labelled and a wrong
 * passphrase fails on the tag rather than producing garbage.
 */

export const SECRETS_BUNDLE_PREFIX = "nixploy-secrets";
export const SECRETS_BUNDLE_VERSION = 1;
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 512;

const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

const secretText = z.string().max(1_048_576).nullable();

const serviceSecretsSchema = z.object({
	env: secretText,
	buildArgs: secretText.optional(),
	previewEnv: secretText.optional(),
});

export const secretsPayloadSchema = z.object({
	version: z.literal(SECRETS_BUNDLE_VERSION),
	project: z.object({ name: z.string(), env: secretText }),
	environment: z.object({ name: z.string(), env: secretText }),
	applications: z.record(z.string(), serviceSecretsSchema),
	compose: z.record(z.string(), serviceSecretsSchema),
	/** Keyed by database kind; a kind with no rows may be omitted. */
	databases: z.record(z.string(), z.record(z.string(), z.object({ env: secretText }))),
});

export type SecretsPayload = z.infer<typeof secretsPayloadSchema>;

export const passphraseSchema = z
	.string()
	.min(MIN_PASSPHRASE_LENGTH, `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`)
	.max(MAX_PASSPHRASE_LENGTH);

const additionalData = () => Buffer.from(`${SECRETS_BUNDLE_PREFIX}:${SECRETS_BUNDLE_VERSION}`);

/** Seal a payload with a passphrase. */
export function sealSecretsBundle(payload: SecretsPayload, passphrase: string): string {
	passphraseSchema.parse(passphrase);
	const salt = randomBytes(SALT_LENGTH);
	const key = scryptSync(passphrase, salt, 32, { ...SCRYPT_PARAMS });
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(additionalData());
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(secretsPayloadSchema.parse(payload)), "utf8"),
		cipher.final(),
	]);
	return [
		SECRETS_BUNDLE_PREFIX,
		String(SECRETS_BUNDLE_VERSION),
		salt.toString("hex"),
		iv.toString("hex"),
		cipher.getAuthTag().toString("hex"),
		ciphertext.toString("hex"),
	].join(":");
}

/** Open a bundle. A wrong passphrase and a tampered bundle both fail the same way. */
export function openSecretsBundle(bundle: string, passphrase: string): SecretsPayload {
	const parts = bundle.trim().split(":");
	const [prefix, version, saltHex, ivHex, tagHex, dataHex] = parts;
	if (
		parts.length !== 6 ||
		prefix !== SECRETS_BUNDLE_PREFIX ||
		version !== String(SECRETS_BUNDLE_VERSION) ||
		!saltHex ||
		!ivHex ||
		!tagHex ||
		dataHex === undefined
	) {
		throw badRequest("Not a Nixploy secrets bundle (expected nixploy-secrets:1:…)");
	}
	const key = scryptSync(passphrase, Buffer.from(saltHex, "hex"), 32, { ...SCRYPT_PARAMS });
	let plaintext: string;
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
		decipher.setAAD(additionalData());
		decipher.setAuthTag(Buffer.from(tagHex, "hex"));
		plaintext = Buffer.concat([
			decipher.update(Buffer.from(dataHex, "hex")),
			decipher.final(),
		]).toString("utf8");
	} catch {
		throw badRequest("Wrong passphrase, or the bundle was altered");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(plaintext);
	} catch {
		throw badRequest("The bundle does not contain a secrets payload");
	}
	const result = secretsPayloadSchema.safeParse(parsed);
	if (!result.success) {
		throw badRequest("The bundle does not contain a secrets payload");
	}
	return result.data;
}

/** The secrets of one environment, read from the rows the exporter already loaded. */
export const collectSecrets = (graph: EnvironmentGraph): SecretsPayload => {
	const { project, environment, services } = graph;
	const databases = Object.fromEntries(
		DATABASE_KINDS.map((kind) => [
			kind,
			Object.fromEntries(services[kind].map((row) => [row.name, { env: row.env ?? null }])),
		]),
	);
	return {
		version: SECRETS_BUNDLE_VERSION,
		project: { name: project.name, env: project.env ?? null },
		environment: { name: environment.name, env: environment.env ?? null },
		applications: Object.fromEntries(
			services.applications.map((row) => [
				row.name,
				{
					env: row.env ?? null,
					buildArgs: row.buildArgs ?? null,
					previewEnv: row.previewEnv ?? null,
				},
			]),
		),
		compose: Object.fromEntries(
			services.compose.map((row) => [
				row.name,
				{
					env: row.env ?? null,
					buildArgs: row.buildArgs ?? null,
					previewEnv: row.previewEnv ?? null,
				},
			]),
		),
		databases,
	};
};

export interface SecretsSummary {
	/** Service entries in the bundle (project and environment env not counted). */
	services: number;
	/** Env keys across every entry, for the audit row — never the values. */
	keys: number;
}

export const summarizeSecrets = (payload: SecretsPayload): SecretsSummary => {
	let services = 0;
	let keys = envKeysFromDotenv(payload.project.env).length;
	keys += envKeysFromDotenv(payload.environment.env).length;
	for (const entry of [...Object.values(payload.applications), ...Object.values(payload.compose)]) {
		services += 1;
		keys += envKeysFromDotenv(entry.env).length;
		keys += envKeysFromDotenv(entry.buildArgs).length;
		keys += envKeysFromDotenv(entry.previewEnv).length;
	}
	for (const kind of DATABASE_KINDS) {
		for (const entry of Object.values(payload.databases[kind] ?? {})) {
			services += 1;
			keys += envKeysFromDotenv(entry.env).length;
		}
	}
	return { services, keys };
};

export interface ApplySecretsResult {
	/** Where the bundle came from, so a mismatch is visible in the response. */
	source: { project: string; environment: string };
	/** Entries written, as `kind/name` (`project` and `environment` for the two envs). */
	applied: string[];
	/** Entries the bundle names that this environment does not have. */
	missing: string[];
}

/**
 * Write a bundle's values onto the environment's rows, matching services by
 * name — the same key the manifest uses. Rows are patched in one transaction
 * so a bundle either lands whole or not at all; the values need a deploy to
 * reach a container, which is the caller's decision (an apply with
 * `secrets` does it before its redeploy).
 */
export const applySecretsPayload = async (
	payload: SecretsPayload,
	graph: EnvironmentGraph,
): Promise<ApplySecretsResult> => {
	const { project, environment, services } = graph;
	const applied: string[] = [];
	const missing: string[] = [];

	await db.transaction(async (tx) => {
		if (payload.project.env !== null) {
			await tx
				.update(projects)
				.set({ env: payload.project.env })
				.where(eq(projects.projectId, project.projectId));
			applied.push("project");
		}
		if (payload.environment.env !== null) {
			await tx
				.update(environments)
				.set({ env: payload.environment.env })
				.where(eq(environments.environmentId, environment.environmentId));
			applied.push("environment");
		}

		const applicationByName = new Map(services.applications.map((row) => [row.name, row]));
		for (const [name, entry] of Object.entries(payload.applications)) {
			const row = applicationByName.get(name);
			if (!row) {
				missing.push(`application/${name}`);
				continue;
			}
			await tx
				.update(applications)
				.set({
					env: entry.env,
					...(entry.buildArgs !== undefined ? { buildArgs: entry.buildArgs } : {}),
					...(entry.previewEnv !== undefined ? { previewEnv: entry.previewEnv } : {}),
				})
				.where(eq(applications.applicationId, row.applicationId));
			applied.push(`application/${name}`);
		}

		const composeByName = new Map(services.compose.map((row) => [row.name, row]));
		for (const [name, entry] of Object.entries(payload.compose)) {
			const row = composeByName.get(name);
			if (!row) {
				missing.push(`compose/${name}`);
				continue;
			}
			await tx
				.update(compose)
				.set({
					env: entry.env,
					...(entry.buildArgs !== undefined ? { buildArgs: entry.buildArgs } : {}),
					...(entry.previewEnv !== undefined ? { previewEnv: entry.previewEnv } : {}),
				})
				.where(eq(compose.composeId, row.composeId));
			applied.push(`compose/${name}`);
		}

		for (const kind of DATABASE_KINDS as readonly DatabaseServiceKind[]) {
			const { module } = databaseDef(kind);
			const byName = new Map(services[kind].map((row) => [row.name, row]));
			for (const [name, entry] of Object.entries(payload.databases[kind] ?? {})) {
				const row = byName.get(name);
				if (!row) {
					missing.push(`${kind}/${name}`);
					continue;
				}
				await module.updateById(module.rowId(row), { env: entry.env }, tx);
				applied.push(`${kind}/${name}`);
			}
		}
	});

	return {
		source: { project: payload.project.name, environment: payload.environment.name },
		applied,
		missing,
	};
};
