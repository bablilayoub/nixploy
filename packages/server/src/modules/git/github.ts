import { randomBytes, randomUUID } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { and, eq } from "drizzle-orm";
import { Octokit } from "octokit";
import { db } from "../../db";
import { github, gitProviders } from "../../db/schema";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_APP_CREATION_URL = "https://github.com/settings/apps/new";

/** State payload round-tripped through the GitHub App manifest flow. */
export type GithubAppState = {
	gitProviderId: string;
	nonce: string;
};

export function encodeGithubAppState(state: GithubAppState): string {
	return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeGithubAppState(state: string): GithubAppState {
	return JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as GithubAppState;
}

export async function findGithubById(githubId: string, organizationId: string) {
	const rows = await db
		.select({ github, organizationId: gitProviders.organizationId })
		.from(github)
		.innerJoin(gitProviders, eq(github.gitProviderId, gitProviders.gitProviderId))
		.where(and(eq(github.githubId, githubId), eq(gitProviders.organizationId, organizationId)))
		.limit(1);
	return rows[0]?.github;
}

export async function listGithubByOrganization(organizationId: string) {
	return await db
		.select({ github, gitProvider: gitProviders })
		.from(github)
		.innerJoin(gitProviders, eq(github.gitProviderId, gitProviders.gitProviderId))
		.where(eq(gitProviders.organizationId, organizationId));
}

export async function createGithub(name: string, organizationId: string) {
	const [provider] = await db
		.insert(gitProviders)
		.values({ name, providerType: "github", organizationId })
		.returning();
	if (!provider) {
		throw new Error("Failed to create git provider row");
	}
	const [row] = await db
		.insert(github)
		.values({ gitProviderId: provider.gitProviderId })
		.returning();
	return { gitProvider: provider, github: row };
}

export async function removeGithub(githubId: string, organizationId: string) {
	const row = await findGithubById(githubId, organizationId);
	if (!row) return undefined;
	// Deleting the parent git_provider cascades to the github row.
	await db.delete(gitProviders).where(eq(gitProviders.gitProviderId, row.gitProviderId));
	return row;
}

export type GithubAppManifestInput = {
	githubId: string;
	organizationId: string;
	/** Public base URL of this Nixploy instance, e.g. https://nixploy.example.com */
	baseUrl: string;
	appName?: string;
	/** Path the browser is sent back to after the app is created. */
	redirectPath?: string;
	/** Path that receives signed webhook deliveries. */
	webhookPath?: string;
};

/**
 * Build the GitHub App manifest flow payload. The UI auto-submits a hidden
 * POST form to `url` with fields `manifest` (stringified) and `state`;
 * GitHub then redirects to `redirect_url` with a `code` that is exchanged
 * via {@link setupGithubApp}. The webhook secret is generated and stored
 * now so it is already on the row when the app is converted.
 */
export async function getGithubAppManifest(input: GithubAppManifestInput) {
	const row = await findGithubById(input.githubId, input.organizationId);
	if (!row) {
		throw new Error(`GitHub provider not found: ${input.githubId}`);
	}
	const baseUrl = input.baseUrl.replace(/\/$/, "");
	const state = encodeGithubAppState({ gitProviderId: row.gitProviderId, nonce: randomUUID() });
	const webhookSecret = randomBytes(32).toString("hex");

	await db
		.update(github)
		.set({ githubWebhookSecret: webhookSecret })
		.where(eq(github.githubId, row.githubId));

	const manifest = {
		name: input.appName || `Nixploy-${randomBytes(3).toString("hex")}`,
		url: baseUrl,
		hook_attributes: {
			url: `${baseUrl}${input.webhookPath ?? "/api/webhook/github"}`,
			active: true,
		},
		redirect_url: `${baseUrl}${input.redirectPath ?? "/api/github/callback"}?state=${state}`,
		callback_urls: [baseUrl],
		public: false,
		default_permissions: {
			contents: "read",
			metadata: "read",
			emails: "read",
		},
		default_events: ["push"],
	};

	return { url: GITHUB_APP_CREATION_URL, manifest: JSON.stringify(manifest), state };
}

type GithubAppConversion = {
	id: number;
	slug: string;
	name: string;
	client_id: string;
	client_secret: string;
	pem: string;
	webhook_secret: string;
};

/**
 * Exchange the manifest `code` (from the GitHub redirect) for real App
 * credentials and store them on the github row. Also discovers the first
 * installation of the app and stores its installation id.
 */
export async function setupGithubApp(input: {
	githubId: string;
	organizationId: string;
	code: string;
	state?: string;
}) {
	const row = await findGithubById(input.githubId, input.organizationId);
	if (!row) {
		throw new Error(`GitHub provider not found: ${input.githubId}`);
	}
	if (input.state) {
		const state = decodeGithubAppState(input.state);
		if (state.gitProviderId !== row.gitProviderId) {
			throw new Error("GitHub App state mismatch");
		}
	}

	const response = await fetch(`${GITHUB_API_URL}/app-manifests/${input.code}/conversions`, {
		method: "POST",
		headers: { Accept: "application/vnd.github+json" },
	});
	if (!response.ok) {
		throw new Error(`GitHub App conversion failed: ${response.status} ${await response.text()}`);
	}
	const app = (await response.json()) as GithubAppConversion;

	const [updated] = await db
		.update(github)
		.set({
			githubAppId: app.id,
			githubAppName: app.slug,
			githubClientId: app.client_id,
			githubClientSecret: app.client_secret,
			githubPrivateKey: app.pem,
			githubWebhookSecret: app.webhook_secret || row.githubWebhookSecret,
		})
		.where(eq(github.githubId, row.githubId))
		.returning();

	await syncGithubInstallation(row.githubId);
	return updated;
}

/** Re-fetch the app's installations and store the most recent one. */
export async function syncGithubInstallation(githubId: string) {
	const [row] = await db.select().from(github).where(eq(github.githubId, githubId)).limit(1);
	if (!row?.githubAppId || !row.githubPrivateKey) {
		throw new Error("GitHub App is not configured yet");
	}
	const auth = createAppAuth({ appId: row.githubAppId, privateKey: row.githubPrivateKey });
	const { token } = await auth({ type: "app" });
	const octokit = new Octokit({ auth: token });
	const installations = await octokit.paginate(octokit.rest.apps.listInstallations, {
		per_page: 100,
	});
	const installation = installations.find((i) => i.app_id === row.githubAppId) ?? installations[0];
	if (!installation) {
		throw new Error("No GitHub App installation found — install the app on an account/org first");
	}
	const [updated] = await db
		.update(github)
		.set({ githubInstallationId: String(installation.id) })
		.where(eq(github.githubId, githubId))
		.returning();
	return updated;
}

function getRowOrThrow(row: Awaited<ReturnType<typeof findGithubById>> | undefined) {
	if (!row?.githubAppId || !row.githubPrivateKey || !row.githubInstallationId) {
		throw new Error(
			"GitHub App is not fully configured (missing app id, private key or installation)",
		);
	}
	return row;
}

/** Installation-authenticated Octokit for a configured github row. */
export function getGithubOctokit(row: {
	githubAppId: number | null;
	githubPrivateKey: string | null;
	githubInstallationId: string | null;
}) {
	if (!row.githubAppId || !row.githubPrivateKey || !row.githubInstallationId) {
		throw new Error(
			"GitHub App is not fully configured (missing app id, private key or installation)",
		);
	}
	return new Octokit({
		authStrategy: createAppAuth,
		auth: {
			appId: row.githubAppId,
			privateKey: row.githubPrivateKey,
			installationId: Number(row.githubInstallationId),
		},
	});
}

export type GithubRepository = {
	id: number;
	name: string;
	fullName: string;
	owner: string;
	private: boolean;
	defaultBranch: string;
	url: string;
};

export async function getGithubRepositories(githubId: string, organizationId: string) {
	const row = getRowOrThrow(await findGithubById(githubId, organizationId));
	const octokit = getGithubOctokit(row);
	const repos = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
		per_page: 100,
	});
	return repos.map(
		(repo): GithubRepository => ({
			id: repo.id,
			name: repo.name,
			fullName: repo.full_name,
			owner: repo.owner?.login ?? "",
			private: repo.private,
			defaultBranch: repo.default_branch,
			url: repo.html_url,
		}),
	);
}

export async function getGithubBranches(input: {
	githubId: string;
	organizationId: string;
	owner: string;
	repo: string;
}) {
	const row = getRowOrThrow(await findGithubById(input.githubId, input.organizationId));
	const octokit = getGithubOctokit(row);
	const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
		owner: input.owner,
		repo: input.repo,
		per_page: 100,
	});
	return branches.map((branch) => branch.name);
}

/** Quick reachability check: resolves the app's own metadata. */
export async function testGithubConnection(githubId: string, organizationId: string) {
	const row = getRowOrThrow(await findGithubById(githubId, organizationId));
	const octokit = getGithubOctokit(row);
	const { data } = await octokit.rest.apps.getAuthenticated();
	return { appName: data?.name ?? row.githubAppName ?? "" };
}
