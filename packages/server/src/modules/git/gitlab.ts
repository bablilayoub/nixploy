import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { gitlab, gitProviders } from "../../db/schema";

export type CreateGitlabInput = {
	name: string;
	gitlabUrl?: string;
	accessToken: string;
	groupName?: string | null;
	applicationId?: string | null;
	secret?: string | null;
	redirectUri?: string | null;
};

export type UpdateGitlabInput = Partial<Omit<CreateGitlabInput, "name">> & {
	refreshToken?: string | null;
	expiresAt?: number | null;
};

export async function findGitlabById(gitlabId: string, organizationId: string) {
	const rows = await db
		.select({ gitlab, organizationId: gitProviders.organizationId })
		.from(gitlab)
		.innerJoin(gitProviders, eq(gitlab.gitProviderId, gitProviders.gitProviderId))
		.where(and(eq(gitlab.gitlabId, gitlabId), eq(gitProviders.organizationId, organizationId)))
		.limit(1);
	return rows[0]?.gitlab;
}

export async function listGitlabByOrganization(organizationId: string) {
	return await db
		.select({ gitlab, gitProvider: gitProviders })
		.from(gitlab)
		.innerJoin(gitProviders, eq(gitlab.gitProviderId, gitProviders.gitProviderId))
		.where(eq(gitProviders.organizationId, organizationId));
}

export async function createGitlab(input: CreateGitlabInput, organizationId: string) {
	const [provider] = await db
		.insert(gitProviders)
		.values({ name: input.name, providerType: "gitlab", organizationId })
		.returning();
	if (!provider) {
		throw new Error("Failed to create git provider row");
	}
	const [row] = await db
		.insert(gitlab)
		.values({
			gitProviderId: provider.gitProviderId,
			gitlabUrl: input.gitlabUrl ?? "https://gitlab.com",
			accessToken: input.accessToken,
			groupName: input.groupName ?? null,
			applicationId: input.applicationId ?? null,
			secret: input.secret ?? null,
			redirectUri: input.redirectUri ?? null,
		})
		.returning();
	return { gitProvider: provider, gitlab: row };
}

export async function updateGitlabById(
	gitlabId: string,
	input: UpdateGitlabInput,
	organizationId: string,
) {
	const existing = await findGitlabById(gitlabId, organizationId);
	if (!existing) return undefined;
	const [row] = await db.update(gitlab).set(input).where(eq(gitlab.gitlabId, gitlabId)).returning();
	return row;
}

export async function updateGitlabProviderName(
	gitlabId: string,
	name: string,
	organizationId: string,
) {
	const existing = await findGitlabById(gitlabId, organizationId);
	if (!existing) return undefined;
	await db
		.update(gitProviders)
		.set({ name })
		.where(eq(gitProviders.gitProviderId, existing.gitProviderId));
	return existing;
}

export async function removeGitlab(gitlabId: string, organizationId: string) {
	const row = await findGitlabById(gitlabId, organizationId);
	if (!row) return undefined;
	await db.delete(gitProviders).where(eq(gitProviders.gitProviderId, row.gitProviderId));
	return row;
}

// ── GitLab REST API (v4) ────────────────────────────────────────────────────

type GitlabRow = NonNullable<Awaited<ReturnType<typeof findGitlabById>>>;

function gitlabApi(row: GitlabRow, path: string) {
	const base = row.gitlabUrl.replace(/\/$/, "");
	return fetch(`${base}/api/v4${path}`, {
		headers: { "PRIVATE-TOKEN": row.accessToken ?? "" },
	});
}

async function assertOk(response: Response, what: string) {
	if (!response.ok) {
		throw new Error(`GitLab ${what} failed: ${response.status}`);
	}
	return response;
}

export type GitlabRepository = {
	id: number;
	name: string;
	pathWithNamespace: string;
	defaultBranch: string | null;
	url: string;
	visibility: string;
};

async function fetchGitlabProjects(row: GitlabRow, path: string) {
	const projects: GitlabRepository[] = [];
	for (let page = 1; page <= 10; page++) {
		const response = await assertOk(
			await gitlabApi(row, `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`),
			"list projects",
		);
		const batch = (await response.json()) as Array<Record<string, unknown>>;
		for (const p of batch) {
			projects.push({
				id: p.id as number,
				name: p.path as string,
				pathWithNamespace: p.path_with_namespace as string,
				defaultBranch: (p.default_branch as string) ?? null,
				url: p.web_url as string,
				visibility: p.visibility as string,
			});
		}
		if (batch.length < 100) break;
	}
	return projects;
}

/**
 * List repositories visible to the configured token. When `groupName` is
 * set, all projects of that group/subgroup are listed; otherwise the
 * projects the token's user is a member of.
 */
export async function getGitlabRepositories(gitlabId: string, organizationId: string) {
	const row = await findGitlabById(gitlabId, organizationId);
	if (!row?.accessToken) {
		throw new Error("GitLab provider is not configured (missing access token)");
	}
	if (row.groupName) {
		return await fetchGitlabProjects(
			row,
			`/groups/${encodeURIComponent(row.groupName)}/projects?include_subgroups=true`,
		);
	}
	return await fetchGitlabProjects(row, "/projects?membership=true&order_by=last_activity_at");
}

/** `project` accepts a numeric id or a URL-encoded path (`group/repo`). */
export async function getGitlabBranches(input: {
	gitlabId: string;
	organizationId: string;
	projectId: string;
}) {
	const row = await findGitlabById(input.gitlabId, input.organizationId);
	if (!row?.accessToken) {
		throw new Error("GitLab provider is not configured (missing access token)");
	}
	const projectId = /^\d+$/.test(input.projectId)
		? input.projectId
		: encodeURIComponent(input.projectId);
	const response = await assertOk(
		await gitlabApi(row, `/projects/${projectId}/repository/branches?per_page=100`),
		"list branches",
	);
	const branches = (await response.json()) as Array<{ name: string }>;
	return branches.map((b) => b.name);
}

export async function testGitlabConnection(gitlabId: string, organizationId: string) {
	const row = await findGitlabById(gitlabId, organizationId);
	if (!row?.accessToken) {
		throw new Error("GitLab provider is not configured (missing access token)");
	}
	const response = await assertOk(await gitlabApi(row, "/user"), "connection test");
	const user = (await response.json()) as { username: string };
	return { username: user.username };
}
