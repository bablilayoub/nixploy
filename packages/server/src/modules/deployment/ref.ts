import { assertSafeGitRef } from "../../utils/public-url";
import { badRequest } from "../errors";

/** Source types that check out a git ref; the rest have nothing to point at. */
const GIT_SOURCE_TYPES = new Set(["git", "github", "gitlab", "bitbucket", "gitea"]);

/**
 * Validate a one-off deploy ref against the service that would build it.
 *
 * Returns `undefined` when nothing was asked for (the normal case — build the
 * configured branch) so callers can spread it straight into `queueDeployment`.
 * A ref on a source with no checkout is a caller mistake, not something to
 * silently drop: a `nixploy app deploy --ref v1.2.0` against a docker-image app
 * would otherwise deploy the wrong thing and report success.
 *
 * The ref is re-validated at use in `cloneGitSource`, because what is stored
 * and what is fetched are separated by a queue and a restart.
 */
export function resolveRequestedRef(
	service: { sourceType: string },
	ref: string | null | undefined,
): string | undefined {
	const value = ref?.trim();
	if (!value) return undefined;
	if (!GIT_SOURCE_TYPES.has(service.sourceType)) {
		throw badRequest(`A ${service.sourceType} source has no git ref to deploy`);
	}
	return assertSafeGitRef(value, "ref");
}
