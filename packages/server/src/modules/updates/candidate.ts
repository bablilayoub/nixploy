import {
	compareVersions,
	imageVersionTag,
	parseVersion,
	releaseTag,
	withImageTag,
} from "./releases";

/**
 * Which image an update check should compare against, and an update roll to.
 *
 * `install.sh` / `update.sh` pin `NIXPLOY_IMAGE` to the release tag they
 * installed (`ghcr.io/…/nixploy:v0.2.1`). That tag is immutable, so comparing
 * its digest with the running container's digest can never say "newer
 * release available" — every pinned install reported "up to date" forever.
 * For a version-tagged image the release channel is the newest GitHub
 * release; for a moving tag (`:latest`, `:main`) the tag itself is the
 * channel and the digest comparison is what detects a change.
 */
export interface UpdateCandidate {
	/** Image reference to compare digests against and to roll to. */
	image: string;
	/** Version tag of that image, null for a moving tag. */
	tag: string | null;
	reason: "moving-tag" | "current-release" | "newer-release" | "capped-by-pin";
}

export function resolveUpdateCandidate(input: {
	trackedImage: string;
	/** Newest final release tag on GitHub (`v0.2.2`), null when unknown. */
	latestReleaseTag: string | null;
	/** Ceiling from settings; automatic and default updates never pass it. */
	pinnedVersion: string | null;
}): UpdateCandidate {
	const currentTag = imageVersionTag(input.trackedImage);
	if (!parseVersion(currentTag)) {
		return { image: input.trackedImage, tag: null, reason: "moving-tag" };
	}
	const latest = input.latestReleaseTag;
	if (!latest || !parseVersion(latest) || compareVersions(latest, currentTag) <= 0) {
		return { image: input.trackedImage, tag: currentTag, reason: "current-release" };
	}
	const pin = input.pinnedVersion && parseVersion(input.pinnedVersion) ? input.pinnedVersion : null;
	if (pin && compareVersions(latest, pin) > 0) {
		// The newest release is past the pin: offer the pin itself when it is
		// still ahead of what runs, otherwise nothing.
		if (compareVersions(pin, currentTag) > 0) {
			const tag = releaseTag(pin);
			return { image: withImageTag(input.trackedImage, tag), tag, reason: "capped-by-pin" };
		}
		return { image: input.trackedImage, tag: currentTag, reason: "capped-by-pin" };
	}
	const tag = releaseTag(latest);
	return { image: withImageTag(input.trackedImage, tag), tag, reason: "newer-release" };
}
