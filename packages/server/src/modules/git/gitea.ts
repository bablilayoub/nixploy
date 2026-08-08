import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { gitea, gitProviders } from "../../db/schema";

export type CreateGiteaInput = {
	name: string;
	giteaUrl?: string;
	accessToken: string;
	redirectUri?: string | null;
};

export type UpdateGiteaInput = Partial<Omit<CreateGiteaInput, "name">> & {
	refreshToken?: string | null;
	expiresAt?: number | null;
	lastSyncedAt?: number | null;
};

export async function findGiteaById(giteaId: string, organizationId: string) {
	const rows = await db
		.select({ gitea, organizationId: gitProviders.organizationId })
		.from(gitea)
		.innerJoin(gitProviders, eq(gitea.gitProviderId, gitProviders.gitProviderId))
		.where(and(eq(gitea.giteaId, giteaId), eq(gitProviders.organizationId, organizationId)))
		.limit(1);
	return rows[0]?.gitea;
}

export async function listGiteaByOrganization(organizationId: string) {
	return await db
		.select({ gitea, gitProvider: gitProviders })
		.from(gitea)
		.innerJoin(gitProviders, eq(gitea.gitProviderId, gitProviders.gitProviderId))
		.where(eq(gitProviders.organizationId, organizationId));
}

export async function createGitea(input: CreateGiteaInput, organizationId: string) {
	const [provider] = await db
		.insert(gitProviders)
		.values({ name: input.name, providerType: "gitea", organizationId })
		.returning();
	if (!provider) {
		throw new Error("Failed to create git provider row");
	}
	const [row] = await db
		.insert(gitea)
		.values({
			gitProviderId: provider.gitProviderId,
			giteaUrl: input.giteaUrl ?? "https://gitea.com",
			accessToken: input.accessToken,
			redirectUri: input.redirectUri ?? null,
		})
		.returning();
	return { gitProvider: provider, gitea: row };
}

export async function updateGiteaById(
	giteaId: string,
	input: UpdateGiteaInput,
	organizationId: string,
) {
	const existing = await findGiteaById(giteaId, organizationId);
	if (!existing) return undefined;
	const [row] = await db.update(gitea).set(input).where(eq(gitea.giteaId, giteaId)).returning();
	return row;
}

export async function updateGiteaProviderName(
	giteaId: string,
	name: string,
	organizationId: string,
) {
	const existing = await findGiteaById(giteaId, organizationId);
	if (!existing) return undefined;
	await db
		.update(gitProviders)
		.set({ name })
		.where(eq(gitProviders.gitProviderId, existing.gitProviderId));
	return existing;
}

export async function removeGitea(giteaId: string, organizationId: string) {
	const row = await findGiteaById(giteaId, organizationId);
	if (!row) return undefined;
	await db.delete(gitProviders).where(eq(gitProviders.gitProviderId, row.gitProviderId));
	return row;
}

// ── Gitea REST API (v1) ─────────────────────────────────────────────────────

type GiteaRow = NonNullable<Awaited<ReturnType<typeof findGiteaById>>>;

async function giteaApi(row: GiteaRow, path: string) {
	const base = row.giteaUrl.replace(/\/$/, "");
	const response = await fetch(`${base}/api/v1${path}`, {
		headers: { Authorization: `token ${row.accessToken ?? ""}` },
	});
	if (!response.ok) {
		throw new Error(`Gitea API request failed: ${response.status}`);
	}
	return response;
}

export type GiteaRepository = {
	id: number;
	name: string;
	fullName: string;
	owner: string;
	private: boolean;
	defaultBranch: string;
	url: string;
	cloneUrl: string;
	sshUrl: string;
};

export async function getGiteaRepositories(giteaId: string, organizationId: string) {
	const row = await findGiteaById(giteaId, organizationId);
	if (!row?.accessToken) {
		throw new Error("Gitea provider is not configured (missing access token)");
	}
	const repos: GiteaRepository[] = [];
	for (let page = 1; page <= 10; page++) {
		const response = await giteaApi(row, `/user/repos?limit=50&page=${page}`);
		const batch = (await response.json()) as Array<Record<string, unknown>>;
		for (const r of batch) {
			const owner = r.owner as { login?: string } | undefined;
			repos.push({
				id: r.id as number,
				name: r.name as string,
				fullName: r.full_name as string,
				owner: owner?.login ?? "",
				private: Boolean(r.private),
				defaultBranch: (r.default_branch as string) ?? "",
				url: (r.html_url as string) ?? "",
				cloneUrl: (r.clone_url as string) ?? "",
				sshUrl: (r.ssh_url as string) ?? "",
			});
		}
		if (batch.length < 50) break;
	}
	return repos;
}

export async function getGiteaBranches(input: {
	giteaId: string;
	organizationId: string;
	owner: string;
	repo: string;
}) {
	const row = await findGiteaById(input.giteaId, input.organizationId);
	if (!row?.accessToken) {
		throw new Error("Gitea provider is not configured (missing access token)");
	}
	const response = await giteaApi(
		row,
		`/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/branches?limit=100`,
	);
	const branches = (await response.json()) as Array<{ name: string }>;
	return branches.map((b) => b.name);
}

export async function testGiteaConnection(giteaId: string, organizationId: string) {
	const row = await findGiteaById(giteaId, organizationId);
	if (!row?.accessToken) {
		throw new Error("Gitea provider is not configured (missing access token)");
	}
	const response = await giteaApi(row, "/user");
	const user = (await response.json()) as { login: string };
	return { username: user.login };
}
