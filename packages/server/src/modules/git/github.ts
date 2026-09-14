import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { and, eq } from "drizzle-orm";
import { Octokit } from "octokit";
import { db } from "../../db";
import { github, gitProviders } from "../../db/schema";

const GITHUB_API_URL = "https://api.github.com";
/** Per-request timeout for GitHub API calls (a stalled API must not pin a request for minutes). */
const GITHUB_REQUEST_TIMEOUT_MS = 15_000;
const GITHUB_APP_CREATION_URL = "https://github.com/settings/apps/new";

/** State payload round-tripped through the GitHub App manifest flow. */
export type GithubAppState = {
	gitProviderId: string;
	githubId: string;
	nonce: string;
};

function githubAppStateSecret(): string {
	const key = process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
	if (!key) {
		throw new Error("ENCRYPTION_KEY (or BETTER_AUTH_SECRET) is required for GitHub App setup");
	}
	return key;
}

export function encodeGithubAppState(state: GithubAppState): string {
	const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
	const sig = createHmac("sha256", githubAppStateSecret()).update(payload).digest("base64url");
	return `${payload}.${sig}`;
}

export function decodeGithubAppState(state: string): GithubAppState {
	const [payload, sig] = state.split(".");
	if (!payload || !sig) {
		throw new Error("Invalid GitHub App state");
	}
	const expected = createHmac("sha256", githubAppStateSecret()).update(payload).digest("base64url");
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		throw new Error("Invalid GitHub App state signature");
	}
	return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GithubAppState;
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

/** Require an absolute http(s) URL; throw otherwise so manifests never ship relative redirects. */
export function assertPublicBaseUrl(value: string): string {
	const trimmed = value.trim().replace(/\/$/, "");
	if (!trimmed) {
		throw new Error("Public base URL is required for GitHub App setup");
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`Invalid public base URL: ${value}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Public base URL must be http(s): ${value}`);
	}
	return trimmed;
}

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
	const baseUrl = assertPublicBaseUrl(input.baseUrl);
	const state = encodeGithubAppState({
		gitProviderId: row.gitProviderId,
		githubId: row.githubId,
		nonce: randomUUID(),
	});
	const webhookSecret = randomBytes(32).toString("hex");

	await db
		.update(github)
		.set({ githubWebhookSecret: webhookSecret })
		.where(eq(github.githubId, row.githubId));

	const redirectPath = "/api/github/callback";
	const webhookPath = `/api/webhooks/github/${row.githubId}`;

	// GitHub validates redirect_url as an absolute URL without relying on query
	// params — pass `state` as a separate form field (see GitHub App Manifest docs).
	const manifest = {
		name: input.appName || `Nixploy-${randomBytes(3).toString("hex")}`,
		url: baseUrl,
		hook_attributes: {
			url: `${baseUrl}${webhookPath.startsWith("/") ? webhookPath : `/${webhookPath}`}`,
			active: true,
		},
		redirect_url: `${baseUrl}${redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`}`,
		callback_urls: [`${baseUrl}/api/github/callback`],
		setup_url: `${baseUrl}/dashboard/settings/git-providers`,
		public: false,
		default_permissions: {
			contents: "read",
			metadata: "read",
			emails: "read",
			pull_requests: "read",
		},
		default_events: ["push", "pull_request"],
	};

	return {
		url: GITHUB_APP_CREATION_URL,
		manifest: JSON.stringify(manifest),
		state,
	};
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
	if (!input.state) {
		throw new Error("GitHub App state is required");
	}
	const state = decodeGithubAppState(input.state);
	if (
		state.gitProviderId !== row.gitProviderId ||
		(state.githubId && state.githubId !== row.githubId)
	) {
		throw new Error("GitHub App state mismatch");
	}

	const response = await fetch(`${GITHUB_API_URL}/app-manifests/${input.code}/conversions`, {
		method: "POST",
		headers: { Accept: "application/vnd.github+json" },
		redirect: "error",
		signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`GitHub App conversion failed: ${response.status}`);
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

	// A freshly created App has no installation until the operator installs it
	// on an account or organization, so this is a best-effort head start — the
	// panel offers an "Install on GitHub" button and syncs on the way back.
	await syncGithubInstallation(row.githubId, { optional: true });
	return updated;
}

/**
 * Where the operator installs a created App on their account or organization.
 * Creating the App (the manifest flow) and INSTALLING it are two separate
 * steps on GitHub's side; nothing works until the second one happened.
 */
export const githubAppInstallUrl = (slug: string): string =>
	`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;

/**
 * Re-fetch the app's installations and store the most recent one.
 *
 * `optional: true` is for the moment right after the App was created, when
 * having no installation yet is the expected state, not a failure.
 */
export async function syncGithubInstallation(
	githubId: string,
	options: { optional?: boolean } = {},
) {
	const [row] = await db.select().from(github).where(eq(github.githubId, githubId)).limit(1);
	if (!row?.githubAppId || !row.githubPrivateKey) {
		throw new Error("GitHub App is not configured yet");
	}
	const auth = createAppAuth({ appId: row.githubAppId, privateKey: row.githubPrivateKey });
	const { token } = await auth({ type: "app" });
	const octokit = new Octokit({ auth: token, request: { timeout: GITHUB_REQUEST_TIMEOUT_MS } });
	const installations = await octokit.paginate(octokit.rest.apps.listInstallations, {
		per_page: 100,
	});
	const installation = installations.find((i) => i.app_id === row.githubAppId) ?? installations[0];
	if (!installation) {
		if (options.optional) return row;
		throw new Error(
			row.githubAppName
				? `GitHub App "${row.githubAppName}" is not installed yet — install it at ${githubAppInstallUrl(row.githubAppName)}, then sync again`
				: "No GitHub App installation found — install the app on an account or organization first",
		);
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
		request: { timeout: GITHUB_REQUEST_TIMEOUT_MS },
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

/**
 * Fork-PR gate bypass: is `username` a collaborator on owner/repo?
 * Returns null when the check cannot run (provider row unusable, API
 * unreachable) so callers fail safe toward requiring approval.
 */
export async function isGithubCollaborator(input: {
	githubId: string;
	owner: string;
	repo: string;
	username: string;
}): Promise<boolean | null> {
	try {
		const [row] = await db
			.select()
			.from(github)
			.where(eq(github.githubId, input.githubId))
			.limit(1);
		if (!row) return null;
		const octokit = getGithubOctokit(row);
		await octokit.rest.repos.checkCollaborator({
			owner: input.owner,
			repo: input.repo,
			username: input.username,
		});
		return true; // 204 — collaborator
	} catch (error) {
		const status = (error as { status?: number } | null)?.status;
		if (status === 404) return false; // not a collaborator
		return null; // API down, bad credentials, … — unknown
	}
}
