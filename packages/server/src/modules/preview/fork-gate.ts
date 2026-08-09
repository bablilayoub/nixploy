/**
 * Fork-PR preview gate. Fork pull requests can carry arbitrary code, so by
 * default (`previewForksRequireApproval`, on for every app) they are not
 * auto-built — an org member approves first. Repo collaborators bypass the
 * gate: their forks are as trusted as branches.
 */

export interface ForkGateInput {
	/** PR head lives in a different repository than the base (fork). */
	isFork: boolean;
	/** Application setting — default true. */
	requireApproval: boolean;
	/**
	 * PR author is a collaborator on the base repository. `null` means the
	 * check could not run (provider unsupported / API down) — fail safe.
	 */
	isCollaborator: boolean | null;
}

export type ForkGateDecision = "allow" | "awaiting_approval";

/** Pure gate decision — unit-tested, no I/O. */
export function decideForkPreviewGate(input: ForkGateInput): ForkGateDecision {
	if (!input.isFork) return "allow";
	if (!input.requireApproval) return "allow";
	if (input.isCollaborator === true) return "allow";
	return "awaiting_approval";
}

/**
 * Detect a fork PR from head/base repo identity. Falls back to the
 * provider's `fork` flag when full names are missing (GitHub omits
 * `head.repo` for deleted forks).
 */
export function isForkPullRequest(input: {
	headRepoFullName?: string | null;
	baseRepoFullName?: string | null;
	headRepoForkFlag?: boolean | null;
}): boolean {
	if (input.headRepoFullName && input.baseRepoFullName) {
		return input.headRepoFullName.toLowerCase() !== input.baseRepoFullName.toLowerCase();
	}
	return input.headRepoForkFlag === true;
}
