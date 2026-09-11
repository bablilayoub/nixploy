import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose } from "../../db/schema";
import { buildCommitUrl, type CommitLinkSource } from "./commit-url";

/**
 * Database side of {@link buildCommitUrl}: load the source row of an
 * application or compose service together with the base URL of the
 * git-provider row it is linked to, so self-hosted GitLab/Gitea/Bitbucket
 * shas link to *their* host instead of the vendor's cloud.
 *
 * The pure URL builder lives in `./commit-url.ts` and stays import-free.
 */

/** Provider base URL of a loaded service row, or null for cloud-only providers. */
function providerUrlOf(row: {
	sourceType: string;
	gitlab?: { gitlabUrl: string | null } | null;
	gitea?: { giteaUrl: string | null } | null;
}): string | null {
	if (row.sourceType === "gitlab") return row.gitlab?.gitlabUrl ?? null;
	if (row.sourceType === "gitea") return row.gitea?.giteaUrl ?? null;
	return null;
}

/** Commit-link source of an application, or null when the row is gone. */
export async function commitLinkSourceForApplication(
	applicationId: string,
): Promise<CommitLinkSource | null> {
	const row = await db.query.applications.findFirst({
		where: eq(applications.applicationId, applicationId),
		columns: { sourceType: true, owner: true, repository: true, gitUrl: true },
		with: {
			gitlab: { columns: { gitlabUrl: true } },
			gitea: { columns: { giteaUrl: true } },
		},
	});
	if (!row) return null;
	return {
		sourceType: row.sourceType,
		owner: row.owner,
		repository: row.repository,
		gitUrl: row.gitUrl,
		providerUrl: providerUrlOf(row),
	};
}

/** Commit-link source of a compose service, or null when the row is gone. */
export async function commitLinkSourceForCompose(
	composeId: string,
): Promise<CommitLinkSource | null> {
	const row = await db.query.compose.findFirst({
		where: eq(compose.composeId, composeId),
		columns: { sourceType: true, owner: true, repository: true, gitUrl: true },
		with: {
			gitlab: { columns: { gitlabUrl: true } },
			gitea: { columns: { giteaUrl: true } },
		},
	});
	if (!row) return null;
	return {
		sourceType: row.sourceType,
		owner: row.owner,
		repository: row.repository,
		gitUrl: row.gitUrl,
		providerUrl: providerUrlOf(row),
	};
}

/**
 * Commit URL for an application's sha, resolved through its provider row.
 * Null whenever the source cannot have a commit page (docker/drop) or the
 * provider base URL is unknown.
 */
export async function commitUrlForApplication(
	applicationId: string,
	sha: string,
): Promise<string | null> {
	const source = await commitLinkSourceForApplication(applicationId);
	return source ? buildCommitUrl(source, sha) : null;
}

/** Commit URL for a compose service's sha, resolved through its provider row. */
export async function commitUrlForCompose(composeId: string, sha: string): Promise<string | null> {
	const source = await commitLinkSourceForCompose(composeId);
	return source ? buildCommitUrl(source, sha) : null;
}
