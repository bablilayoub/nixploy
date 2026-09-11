import Docker from "dockerode";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { registry } from "../../db/schema";
import { execAsyncWithStdin } from "../../utils/exec";
import { notFound } from "../errors";

export type CreateRegistryInput = {
	registryName: string;
	username: string;
	password: string;
	registryUrl?: string;
	registryType?: "cloud" | "selfHosted";
	imagePrefix?: string | null;
};

export type UpdateRegistryInput = Partial<CreateRegistryInput>;

export async function findRegistryById(registryId: string, organizationId: string) {
	return await db.query.registry.findFirst({
		where: and(eq(registry.registryId, registryId), eq(registry.organizationId, organizationId)),
	});
}

export async function listRegistriesByOrganization(organizationId: string) {
	return await db.query.registry.findMany({
		where: eq(registry.organizationId, organizationId),
		orderBy: (fields, { desc }) => [desc(fields.createdAt)],
	});
}

export async function createRegistry(input: CreateRegistryInput, organizationId: string) {
	const [row] = await db
		.insert(registry)
		.values({ ...input, organizationId })
		.returning();
	return row;
}

export async function updateRegistryById(
	registryId: string,
	input: UpdateRegistryInput,
	organizationId: string,
) {
	const [row] = await db
		.update(registry)
		.set(input)
		.where(and(eq(registry.registryId, registryId), eq(registry.organizationId, organizationId)))
		.returning();
	return row;
}

export async function removeRegistry(registryId: string, organizationId: string) {
	const [row] = await db
		.delete(registry)
		.where(and(eq(registry.registryId, registryId), eq(registry.organizationId, organizationId)))
		.returning();
	return row;
}

const DOCKER_HUB_SERVERADDRESS = "https://index.docker.io/v1/";

/**
 * Verify registry credentials by performing a real `docker login`.
 * Runs against the local Docker daemon via dockerode, or on a remote
 * managed server over SSH when `serverId` is given.
 */
export async function testRegistry(input: {
	registryId: string;
	organizationId: string;
	serverId?: string | null;
}): Promise<{ success: boolean }> {
	const row = await findRegistryById(input.registryId, input.organizationId);
	if (!row) {
		throw notFound(`Registry not found: ${input.registryId}`);
	}

	if (input.serverId) {
		const sq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
		const serverAddress = row.registryUrl || "docker.io";
		// The password travels on the SSH channel's stdin, never on the remote
		// argv (visible in `ps` to every user of that host).
		await execAsyncWithStdin(
			`docker login ${sq(serverAddress)} -u ${sq(row.username)} --password-stdin`,
			row.password,
			{ serverId: input.serverId },
		);
		return { success: true };
	}

	const docker = new Docker();
	await docker.checkAuth({
		username: row.username,
		password: row.password,
		serveraddress: row.registryUrl || DOCKER_HUB_SERVERADDRESS,
	});
	return { success: true };
}
