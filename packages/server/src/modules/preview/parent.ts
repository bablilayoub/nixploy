import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose } from "../../db/schema";

/**
 * The two things a preview can hang off — an application or a compose service —
 * reduced to the columns the preview lifecycle actually reads.
 *
 * Both parent tables carry the same five preview knobs under the same names
 * (`isPreviewDeploymentsActive`, `previewForksRequireApproval`, `previewEnv`,
 * `previewLimit`, `previewTtlHours`) and the same provider columns, so the
 * fork gate, the PR comment, the limit, the TTL and the teardown are written
 * once against this shape instead of branching per kind. Only three things
 * genuinely differ and they stay explicit: what a deploy target looks like
 * (swarm service vs compose project), how many domains a preview gets (one vs
 * one per exposed compose service) and how it is torn down.
 */

export type PreviewParentKind = "application" | "compose";

export interface PreviewParent {
	kind: PreviewParentKind;
	/** `applicationId` or `composeId` — the id column of the parent row. */
	id: string;
	/** Display name, used in error messages. */
	name: string;
	/** Production service name; previews are `<appName>-pr-<n>`. */
	appName: string;
	serverId: string | null;
	/** Branch a preview falls back to when the delivery carries no source ref. */
	defaultBranch: string | null;
	isPreviewDeploymentsActive: boolean;
	previewForksRequireApproval: boolean;
	previewLimit: number;
	previewTtlHours: number | null;
	// Provider identity: the fork-collaborator lookup, the PR comment and the
	// commit-link derivation all need it.
	sourceType: string;
	owner: string | null;
	repository: string | null;
	githubId: string | null;
	gitlabId: string | null;
	bitbucketId: string | null;
	giteaId: string | null;
}

/** Which parent a caller means. Exactly one id may be set. */
export type PreviewParentRef = { applicationId?: string | null; composeId?: string | null };

/** Narrow a ref to its single id, or null when it names zero or two parents. */
export function previewParentRef(ref: PreviewParentRef): {
	kind: PreviewParentKind;
	id: string;
} | null {
	const hasApplication = Boolean(ref.applicationId);
	const hasCompose = Boolean(ref.composeId);
	if (hasApplication === hasCompose) return null;
	return hasApplication
		? { kind: "application", id: ref.applicationId as string }
		: { kind: "compose", id: ref.composeId as string };
}

type ApplicationParentRow = Pick<
	typeof applications.$inferSelect,
	| "applicationId"
	| "name"
	| "appName"
	| "serverId"
	| "branch"
	| "gitBranch"
	| "isPreviewDeploymentsActive"
	| "previewForksRequireApproval"
	| "previewLimit"
	| "previewTtlHours"
	| "sourceType"
	| "owner"
	| "repository"
	| "githubId"
	| "gitlabId"
	| "bitbucketId"
	| "giteaId"
>;

type ComposeParentRow = Pick<
	typeof compose.$inferSelect,
	| "composeId"
	| "name"
	| "appName"
	| "serverId"
	| "branch"
	| "gitBranch"
	| "isPreviewDeploymentsActive"
	| "previewForksRequireApproval"
	| "previewLimit"
	| "previewTtlHours"
	| "sourceType"
	| "owner"
	| "repository"
	| "githubId"
	| "gitlabId"
	| "bitbucketId"
	| "giteaId"
>;

export function applicationPreviewParent(row: ApplicationParentRow): PreviewParent {
	return {
		kind: "application",
		id: row.applicationId,
		name: row.name,
		appName: row.appName,
		serverId: row.serverId,
		defaultBranch: row.branch ?? row.gitBranch ?? null,
		isPreviewDeploymentsActive: row.isPreviewDeploymentsActive,
		previewForksRequireApproval: row.previewForksRequireApproval,
		previewLimit: row.previewLimit,
		previewTtlHours: row.previewTtlHours,
		sourceType: row.sourceType,
		owner: row.owner,
		repository: row.repository,
		githubId: row.githubId,
		gitlabId: row.gitlabId,
		bitbucketId: row.bitbucketId,
		giteaId: row.giteaId,
	};
}

export function composePreviewParent(row: ComposeParentRow): PreviewParent {
	return {
		kind: "compose",
		id: row.composeId,
		name: row.name,
		appName: row.appName,
		serverId: row.serverId,
		defaultBranch: row.branch ?? row.gitBranch ?? null,
		isPreviewDeploymentsActive: row.isPreviewDeploymentsActive,
		previewForksRequireApproval: row.previewForksRequireApproval,
		previewLimit: row.previewLimit,
		previewTtlHours: row.previewTtlHours,
		sourceType: row.sourceType,
		owner: row.owner,
		repository: row.repository,
		githubId: row.githubId,
		gitlabId: row.gitlabId,
		bitbucketId: row.bitbucketId,
		giteaId: row.giteaId,
	};
}

/** Load the parent named by a ref, or null when it is missing / ambiguous. */
export async function loadPreviewParent(ref: PreviewParentRef): Promise<PreviewParent | null> {
	const target = previewParentRef(ref);
	if (!target) return null;
	if (target.kind === "application") {
		const row = await db.query.applications.findFirst({
			where: eq(applications.applicationId, target.id),
		});
		return row ? applicationPreviewParent(row) : null;
	}
	const row = await db.query.compose.findFirst({
		where: eq(compose.composeId, target.id),
	});
	return row ? composePreviewParent(row) : null;
}

/** The parent of an existing preview row. */
export async function loadPreviewParentForPreview(preview: {
	applicationId: string | null;
	composeId: string | null;
}): Promise<PreviewParent | null> {
	return await loadPreviewParent({
		applicationId: preview.applicationId,
		composeId: preview.composeId,
	});
}
