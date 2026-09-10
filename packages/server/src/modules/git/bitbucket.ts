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
const BITBUCKET_REQUEST_TIMEOUT_MS = 15_000;
const BITBUCKET_MAX_PAGES = 50;

type BitbucketRow = NonNullable<Awaited<ReturnType<typeof findBitbucketById>>>;

/** Only follow `next` links that stay on the Bitbucket API origin. */
function assertBitbucketPaginationUrl(next: string): void {
	if (!next.startsWith(`${BITBUCKET_API_URL}/`) && next !== `${BITBUCKET_API_URL}`) {
		throw new Error("Bitbucket pagination URL is not allowed");
	}
}

/** Walk a paginated Bitbucket collection (`values` + `next`). */
async function bitbucketPaginate<T>(row: BitbucketRow, first: string, what: string): Promise<T[]> {
	const values: T[] = [];
	let next: string | null = first;
	for (let page = 0; next && page < BITBUCKET_MAX_PAGES; page++) {
		assertBitbucketPaginationUrl(next);
		const response: Response = await fetch(next, {
			headers: { Authorization: bitbucketAuthHeader(row) },
			redirect: "error",
			signal: AbortSignal.timeout(BITBUCKET_REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(`Bitbucket ${what} failed: ${response.status}`);
		}
		const data = (await response.json()) as { values: T[]; next?: string };
		values.push(...data.values);
		next = data.next ?? null;
	}
	return values;
}

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
		redirect: "error",
		signal: AbortSignal.timeout(BITBUCKET_REQUEST_TIMEOUT_MS),
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

	const values = await bitbucketPaginate<Record<string, unknown>>(
		row,
		`${BITBUCKET_API_URL}${path}${path.includes("?") ? "&" : "?"}pagelen=100`,
		"list repositories",
	);
	return values.map((r): BitbucketRepository => {
		const mainbranch = r.mainbranch as { name?: string } | undefined;
		const links = r.links as { html?: { href?: string } } | undefined;
		return {
			uuid: r.uuid as string,
			name: r.name as string,
			fullName: r.full_name as string,
			slug: r.slug as string,
			private: Boolean(r.is_private),
			defaultBranch: mainbranch?.name ?? null,
			url: links?.html?.href ?? "",
		};
	});
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
	const branches = await bitbucketPaginate<{ name: string }>(
		row,
		`${BITBUCKET_API_URL}/repositories/${encodeURIComponent(input.workspace)}/${encodeURIComponent(input.repoSlug)}/refs/branches?pagelen=100`,
		"list branches",
	);
	return branches.map((b) => b.name);
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

/**
 * Fork-PR gate bypass: does `username` have an explicit permission on
 * workspace/repo? Returns null when the check cannot run (provider row
 * unusable, API unreachable) so callers fail safe toward requiring approval.
 */
export async function isBitbucketCollaborator(input: {
	bitbucketId: string;
	owner: string;
	repo: string;
	username: string;
}): Promise<boolean | null> {
	try {
		const [row] = await db
			.select()
			.from(bitbucket)
			.where(eq(bitbucket.bitbucketId, input.bitbucketId))
			.limit(1);
		if (!row) return null;
		const query = `user.username="${input.username.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
		const path =
			`/repositories/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}` +
			`/permissions/users?q=${encodeURIComponent(query)}`;
		const response = await fetch(`${BITBUCKET_API_URL}${path}`, {
			headers: { Authorization: bitbucketAuthHeader(row) },
			redirect: "error",
			signal: AbortSignal.timeout(BITBUCKET_REQUEST_TIMEOUT_MS),
		});
		if (response.status === 404) return false;
		if (!response.ok) return null;
		const data = (await response.json()) as { values?: unknown[] };
		return (data.values?.length ?? 0) > 0;
	} catch {
		return null;
	}
}
