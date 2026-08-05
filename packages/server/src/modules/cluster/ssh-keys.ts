import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { sshKeys } from "../../db/schema";
import { execAsync } from "../../utils/exec";

export type CreateSshKeyInput = {
	name: string;
	description?: string | null;
	privateKey: string;
	publicKey: string;
};

export type UpdateSshKeyInput = Partial<Omit<CreateSshKeyInput, "privateKey" | "publicKey">>;

export async function findSshKeyById(sshKeyId: string, organizationId: string) {
	return await db.query.sshKeys.findFirst({
		where: and(eq(sshKeys.sshKeyId, sshKeyId), eq(sshKeys.organizationId, organizationId)),
	});
}

export async function listSshKeysByOrganization(organizationId: string) {
	return await db.query.sshKeys.findMany({
		where: eq(sshKeys.organizationId, organizationId),
		orderBy: (fields, { desc }) => [desc(fields.createdAt)],
	});
}

export async function createSshKey(input: CreateSshKeyInput, organizationId: string) {
	const [sshKey] = await db
		.insert(sshKeys)
		.values({ ...input, organizationId })
		.returning();
	return sshKey;
}

export async function updateSshKeyById(
	sshKeyId: string,
	input: UpdateSshKeyInput,
	organizationId: string,
) {
	const [sshKey] = await db
		.update(sshKeys)
		.set(input)
		.where(and(eq(sshKeys.sshKeyId, sshKeyId), eq(sshKeys.organizationId, organizationId)))
		.returning();
	return sshKey;
}

export async function removeSshKey(sshKeyId: string, organizationId: string) {
	const [sshKey] = await db
		.delete(sshKeys)
		.where(and(eq(sshKeys.sshKeyId, sshKeyId), eq(sshKeys.organizationId, organizationId)))
		.returning();
	return sshKey;
}

/**
 * Generate an ed25519 keypair on the Nixploy host with `ssh-keygen`.
 * The returned private key is in OpenSSH format, ready to be stored
 * (encryptedText) and used by ssh2 (`execAsyncRemote`).
 */
export async function generateSshKeyPair(name = "nixploy"): Promise<{
	privateKey: string;
	publicKey: string;
}> {
	const dir = await mkdtemp(path.join(tmpdir(), "nixploy-ssh-"));
	const keyPath = path.join(dir, "id_ed25519");
	// The comment is caller-supplied, so it is both sanitized and quoted.
	const comment = `${name.replace(/[^\w.@-]/g, "_")}@nixploy`;
	try {
		await execAsync(`ssh-keygen -t ed25519 -f '${keyPath}' -N '' -C '${comment}'`);
		const [privateKey, publicKey] = await Promise.all([
			readFile(keyPath, "utf8"),
			readFile(`${keyPath}.pub`, "utf8"),
		]);
		return { privateKey, publicKey: publicKey.trim() };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
