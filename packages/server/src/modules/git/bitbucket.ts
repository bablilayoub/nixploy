import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { bitbucket, gitProviders } from "../../db/schema";

export type CreateBitbucketInput = {
	name: string;
	bitbucketUsername?: string | null;
	bitbucketWorkspaceName?: string | null;
	appPassword?: string | null;
	apiToken?: string | null;
};

export type UpdateBitbucketInput = Partial<Omit<CreateBitbucketInput, "name">>;

export async function findBitbucketById(bitbucketId: string, organizationId: string) {
	const rows = await db
		.select({ bitbucket, organizationId: gitProviders.organizationId })
		.from(bitbucket)
		.innerJoin(gitProviders, eq(bitbucket.gitProviderId, gitProviders.gitProviderId))
		.where(
			and(eq(bitbucket.bitbucketId, bitbucketId), eq(gitProviders.organizationId, organizationId)),
		)
		.limit(1);
	return rows[0]?.bitbucket;
}

export async function listBitbucketByOrganization(organizationId: string) {
	return await db
		.select({ bitbucket, gitProvider: gitProviders })
		.from(bitbucket)
		.innerJoin(gitProviders, eq(bitbucket.gitProviderId, gitProviders.gitProviderId))
		.where(eq(gitProviders.organizationId, organizationId));
}

export async function createBitbucket(input: CreateBitbucketInput, organizationId: string) {
	const [provider] = await db
		.insert(gitProviders)
		.values({ name: input.name, providerType: "bitbucket", organizationId })
		.returning();
	if (!provider) {
		throw new Error("Failed to create git provider row");
	}
	const [row] = await db
		.insert(bitbucket)
		.values({
			gitProviderId: provider.gitProviderId,
			bitbucketUsername: input.bitbucketUsername ?? null,
			bitbucketWorkspaceName: input.bitbucketWorkspaceName ?? null,
			appPassword: input.appPassword ?? null,
			apiToken: input.apiToken ?? null,
		})
		.returning();
	return { gitProvider: provider, bitbucket: row };
}

export async function updateBitbucketById(
	bitbucketId: string,
	input: UpdateBitbucketInput,
	organizationId: string,
) {
	const existing = await findBitbucketById(bitbucketId, organizationId);
	if (!existing) return undefined;
	const [row] = await db
		.update(bitbucket)
		.set(input)
		.where(eq(bitbucket.bitbucketId, bitbucketId))
		.returning();
	return row;
}

export async function updateBitbucketProviderName(
	bitbucketId: string,
	name: string,
	organizationId: string,
) {
	const existing = await findBitbucketById(bitbucketId, organizationId);
	if (!existing) return undefined;
	await db
		.update(gitProviders)
		.set({ name })
		.where(eq(gitProviders.gitProviderId, existing.gitProviderId));
	return existing;
}

export async function removeBitbucket(bitbucketId: string, organizationId: string) {
	const row = await findBitbucketById(bitbucketId, organizationId);
	if (!row) return undefined;
	await db.delete(gitProviders).where(eq(gitProviders.gitProviderId, row.gitProviderId));
	return row;
}

// ── Bitbucket Cloud REST API (2.0) ──────────────────────────────────────────

const BITBUCKET_API_URL = "https://api.bitbucket.org/2.0";

type BitbucketRow = NonNullable<Awaited<ReturnType<typeof findBitbucketById>>>;

function bitbucketAuthHeader(row: BitbucketRow): string {
	if (row.apiToken) {
		return `Bearer ${row.apiToken}`;
	}
	if (row.bitbucketUsername && row.appPassword) {
		return `Basic ${Buffer.from(`${row.bitbucketUsername}:${row.appPassword}`).toString("base64")}`;
	}
	throw new Error("Bitbucket provider is not configured (missing api token or app password)");
}

async function bitbucketApi(row: BitbucketRow, path: string) {
	const response = await fetch(`${BITBUCKET_API_URL}${path}`, {
		headers: { Authorization: bitbucketAuthHeader(row) },
	});
	if (!response.ok) {
		throw new Error(`Bitbucket API request failed: ${response.status}`);
	}
	return response;
}

export type BitbucketRepository = {
	uuid: string;
	name: string;
	fullName: string;
	slug: string;
	private: boolean;
	defaultBranch: string | null;
	url: string;
};

export async function getBitbucketRepositories(bitbucketId: string, organizationId: string) {
	const row = await findBitbucketById(bitbucketId, organizationId);
	if (!row) {
		throw new Error(`Bitbucket provider not found: ${bitbucketId}`);
	}
	const workspace = row.bitbucketWorkspaceName;
	const path = workspace
		? `/repositories/${encodeURIComponent(workspace)}`
		: "/repositories?role=member";

	const repos: BitbucketRepository[] = [];
	let next: string | null =
		`${BITBUCKET_API_URL}${path}${path.includes("?") ? "&" : "?"}pagelen=100`;
	while (next) {
		const response: Response = await fetch(next, {
			headers: { Authorization: bitbucketAuthHeader(row) },
		});
		if (!response.ok) {
			throw new Error(`Bitbucket list repositories failed: ${response.status}`);
		}
		const data = (await response.json()) as {
			values: Array<Record<string, unknown>>;
			next?: string;
		};
		for (const r of data.values) {
			const mainbranch = r.mainbranch as { name?: string } | undefined;
			const links = r.links as { html?: { href?: string } } | undefined;
			repos.push({
				uuid: r.uuid as string,
				name: r.name as string,
				fullName: r.full_name as string,
				slug: r.slug as string,
				private: Boolean(r.is_private),
				defaultBranch: mainbranch?.name ?? null,
				url: links?.html?.href ?? "",
			});
		}
		next = data.next ?? null;
	}
	return repos;
}

export async function getBitbucketBranches(input: {
	bitbucketId: string;
	organizationId: string;
	workspace: string;
	repoSlug: string;
}) {
	const row = await findBitbucketById(input.bitbucketId, input.organizationId);
	if (!row) {
		throw new Error(`Bitbucket provider not found: ${input.bitbucketId}`);
	}
	const response = await bitbucketApi(
		row,
		`/repositories/${encodeURIComponent(input.workspace)}/${encodeURIComponent(input.repoSlug)}/refs/branches?pagelen=100`,
	);
	const data = (await response.json()) as { values: Array<{ name: string }> };
	return data.values.map((b) => b.name);
}

export async function testBitbucketConnection(bitbucketId: string, organizationId: string) {
	const row = await findBitbucketById(bitbucketId, organizationId);
	if (!row) {
		throw new Error(`Bitbucket provider not found: ${bitbucketId}`);
	}
	const response = await bitbucketApi(row, "/user");
	const user = (await response.json()) as { username?: string; display_name?: string };
	return { username: user.username ?? user.display_name ?? "" };
}
