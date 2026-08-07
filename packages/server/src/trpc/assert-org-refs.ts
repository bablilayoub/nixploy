import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { bitbucket, gitea, github, gitlab } from "../db/schema";
import { findServerById } from "../modules/cluster/servers";
import { findSshKeyById } from "../modules/cluster/ssh-keys";

/** Reject attaching another org's managed server (cross-tenant SSH). */
export async function assertServerInOrganization(
	serverId: string | null | undefined,
	organizationId: string,
): Promise<void> {
	if (!serverId) return;
	const server = await findServerById(serverId, organizationId);
	if (!server) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
	}
}

/** Reject attaching another org's SSH key. */
export async function assertSshKeyInOrganization(
	sshKeyId: string | null | undefined,
	organizationId: string,
): Promise<void> {
	if (!sshKeyId) return;
	const key = await findSshKeyById(sshKeyId, organizationId);
	if (!key) {
		throw new TRPCError({ code: "NOT_FOUND", message: "SSH key not found" });
	}
}

/** Verify a git provider connection belongs to the caller's org. */
export async function assertGitProviderInOrganization(
	provider: "github" | "gitlab" | "bitbucket" | "gitea",
	providerId: string,
	organizationId: string,
): Promise<void> {
	let row: { gitProvider: { organizationId: string } } | undefined;
	switch (provider) {
		case "github":
			row = await db.query.github.findFirst({
				where: eq(github.githubId, providerId),
				with: { gitProvider: true },
			});
			break;
		case "gitlab":
			row = await db.query.gitlab.findFirst({
				where: eq(gitlab.gitlabId, providerId),
				with: { gitProvider: true },
			});
			break;
		case "bitbucket":
			row = await db.query.bitbucket.findFirst({
				where: eq(bitbucket.bitbucketId, providerId),
				with: { gitProvider: true },
			});
			break;
		case "gitea":
			row = await db.query.gitea.findFirst({
				where: eq(gitea.giteaId, providerId),
				with: { gitProvider: true },
			});
			break;
	}
	if (!row || row.gitProvider.organizationId !== organizationId) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `${provider} provider not found`,
		});
	}
}
