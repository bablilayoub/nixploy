import type { ComposeFileSpec, ComposeServiceSpec } from "./parse";
import { ComposeValidationError } from "./parse";

/**
 * Compose stacks that build their images from the repository instead of
 * pulling them.
 *
 * Nixploy builds, compose runs: every `build:` block is validated here, built
 * by the ordinary Dockerfile builder, and replaced with the resulting `image:`
 * before the file ever reaches `docker compose`. Compose therefore never reads
 * a host path, never resolves a Dockerfile itself, and never sees a build
 * context — which is what lets a stack use `build:` without handing the tenant
 * the host filesystem.
 *
 * Everything in this module is pure so the rules are unit-testable; the
 * building itself lives in the worker.
 */

/** Keys of a `build:` block Nixploy supports. Anything else is refused. */
const ALLOWED_BUILD_KEYS = new Set(["context", "dockerfile", "target", "args"]);

/**
 * Keys that are refused with a specific reason rather than the generic
 * message, because each one is a way out of the sandbox or a Nixploy
 * responsibility the stack must not take over.
 */
const REFUSED_BUILD_KEYS: Record<string, string> = {
	dockerfile_inline: "writes a Dockerfile from the compose file",
	ssh: "forwards an SSH agent into the build",
	secrets: "Nixploy supplies build secrets itself (use build args)",
	network: "changes the build network",
	cache_from: "Nixploy manages the build cache",
	cache_to: "Nixploy manages the build cache",
	extra_hosts: "rewrites name resolution during the build",
	privileged: "runs build steps privileged",
	no_cache: "Nixploy manages the build cache",
	pull: "Nixploy manages base-image pulls",
	tags: "Nixploy owns the image tag",
	platforms: "multi-platform builds are not supported yet",
};

/** One service that builds from source, normalized. */
export interface ComposeBuildTarget {
	/** Service name as it appears in the *raw* file (before any suffix). */
	serviceName: string;
	/** Build context, relative to the checkout root. `.` means the root. */
	context: string;
	/** Dockerfile path, relative to the context. */
	dockerfile: string;
	/** `--target` stage, when the block named one. */
	target: string | null;
	/** `--build-arg` keys declared by the block; values come from the env. */
	argKeys: string[];
}

/**
 * A path inside the checkout: relative, no `..` segment, no absolute or
 * home-relative form, no NUL. The realpath confinement check still runs at
 * build time — this is the cheap, early half that keeps a bad file from
 * reaching the builder at all.
 */
function assertCheckoutRelativePath(value: string, label: string, serviceName: string): string {
	const path = value.trim();
	if (
		!path ||
		path.startsWith("/") ||
		path.startsWith("~") ||
		path.includes("\0") ||
		path.split("/").includes("..") ||
		/^[a-zA-Z]:[\\/]/.test(path)
	) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": ${label} must be a path inside the repository (got "${value}")`,
		);
	}
	return path;
}

/**
 * Validate one `build:` block and normalize it. Accepts the short form
 * (`build: ./dir`) and the long form, and nothing else.
 */
export function parseBuildBlock(serviceName: string, build: unknown): ComposeBuildTarget {
	if (typeof build === "string") {
		return {
			serviceName,
			context: assertCheckoutRelativePath(build, "build context", serviceName),
			dockerfile: "Dockerfile",
			target: null,
			argKeys: [],
		};
	}
	if (!build || typeof build !== "object" || Array.isArray(build)) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": build: must be a path or a mapping`,
		);
	}

	const block = build as Record<string, unknown>;
	for (const key of Object.keys(block)) {
		const reason = REFUSED_BUILD_KEYS[key];
		if (reason) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}": build.${key} is not allowed (${reason})`,
			);
		}
		if (!ALLOWED_BUILD_KEYS.has(key)) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}": build.${key} is not supported`,
			);
		}
	}

	const rawContext = block.context ?? ".";
	if (typeof rawContext !== "string") {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": build.context must be a string`,
		);
	}
	// A remote context (git URL) would make compose fetch it itself.
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawContext) || rawContext.startsWith("git@")) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": build.context must be a path in the repository, not a URL`,
		);
	}
	const context = assertCheckoutRelativePath(rawContext, "build context", serviceName);

	const rawDockerfile = block.dockerfile ?? "Dockerfile";
	if (typeof rawDockerfile !== "string") {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": build.dockerfile must be a string`,
		);
	}
	const dockerfile = assertCheckoutRelativePath(rawDockerfile, "build.dockerfile", serviceName);

	let target: string | null = null;
	if (block.target !== undefined && block.target !== null) {
		if (typeof block.target !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(block.target)) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}": build.target must be a stage name`,
			);
		}
		target = block.target;
	}

	// Values are ignored on purpose: build args are resolved from the stack's
	// own build-args blob, so a compose file can declare which keys it wants
	// without carrying their values in the repository.
	const argKeys: string[] = [];
	if (block.args !== undefined && block.args !== null) {
		const { args } = block;
		if (Array.isArray(args)) {
			for (const entry of args) {
				if (typeof entry !== "string") {
					throw new ComposeValidationError(
						`Compose service "${serviceName}": build.args entries must be strings`,
					);
				}
				argKeys.push(entry.split("=")[0] ?? "");
			}
		} else if (typeof args === "object") {
			argKeys.push(...Object.keys(args as Record<string, unknown>));
		} else {
			throw new ComposeValidationError(
				`Compose service "${serviceName}": build.args must be a list or a mapping`,
			);
		}
		for (const key of argKeys) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				throw new ComposeValidationError(
					`Compose service "${serviceName}": "${key}" is not a valid build arg name`,
				);
			}
		}
	}

	return { serviceName, context, dockerfile, target, argKeys };
}

/**
 * Every service in the spec that builds from source, in file order.
 * Returns an empty list when nothing builds, so callers can skip the whole
 * build phase without a flag.
 */
export function collectComposeBuildTargets(spec: ComposeFileSpec): ComposeBuildTarget[] {
	const targets: ComposeBuildTarget[] = [];
	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		const build = (service as ComposeServiceSpec).build;
		if (build === undefined || build === null) continue;
		targets.push(parseBuildBlock(serviceName, build));
	}
	return targets;
}

/**
 * Replace every `build:` with the image Nixploy built for it.
 *
 * A service that declares both `build:` and `image:` in compose means "build
 * it and call it this" — Nixploy owns the tag instead, so the built image
 * always wins. Missing entries are left alone: `buildDeployComposeFile` is
 * also called for validation-only paths, where nothing has been built yet.
 */
export function applyBuiltImages(
	spec: ComposeFileSpec,
	images: ReadonlyMap<string, string>,
): ComposeFileSpec {
	if (images.size === 0) return spec;
	const services: Record<string, ComposeServiceSpec> = {};
	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		const image = images.get(serviceName);
		if (!image || service.build === undefined || service.build === null) {
			services[serviceName] = service;
			continue;
		}
		const { build: _build, ...rest } = service;
		services[serviceName] = { ...rest, image };
	}
	return { ...spec, services };
}

/** Image tag for one built compose service: `<appName>-<service>:<deploymentId>`. */
export function composeBuildImageTag(
	appName: string,
	serviceName: string,
	deploymentId: string,
): string {
	return `${appName}-${serviceName}:${deploymentId}`;
}
