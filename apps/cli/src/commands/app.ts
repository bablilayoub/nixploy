import type { Command } from "commander";
import { apiGet, apiPost, apiUpload } from "../client.js";
import { usageError } from "../errors.js";
import { addOutputOptions, printRecord, printResult } from "../utils/output.js";
import { followDeploymentLogs } from "./deployment.js";
import { addServiceEnvCommands } from "./service-env.js";

/**
 * Application verbs that need more than a field mapping: source configuration
 * (the `sourceType` discriminator is inferred from the flags), log following,
 * and the env shortcuts that delegate to the scope-aware `env` group.
 */

interface SourceOptions {
	dockerImage?: string;
	registryId?: string;
	gitUrl?: string;
	branch?: string;
	sshKeyId?: string;
	githubId?: string;
	gitlabId?: string;
	bitbucketId?: string;
	giteaId?: string;
	owner?: string;
	repository?: string;
	buildPath?: string;
	watchPaths?: string;
	autoDeploy?: boolean;
}

/** Infer `sourceType` from the flags so callers never repeat themselves. */
export function buildSourceInput(
	applicationId: string,
	options: SourceOptions,
): Record<string, unknown> {
	const base: Record<string, unknown> = { applicationId };
	if (options.buildPath) base.buildPath = options.buildPath;
	if (options.autoDeploy !== undefined) base.autoDeploy = options.autoDeploy;
	if (options.watchPaths) {
		base.watchPaths = options.watchPaths
			.split(",")
			.map((path) => path.trim())
			.filter(Boolean);
	}

	if (options.dockerImage) {
		return {
			...base,
			sourceType: "docker",
			dockerImage: options.dockerImage,
			registryId: options.registryId ?? null,
		};
	}

	const provider = (
		[
			["github", options.githubId],
			["gitlab", options.gitlabId],
			["bitbucket", options.bitbucketId],
			["gitea", options.giteaId],
		] as const
	).find(([, id]) => Boolean(id));

	if (provider) {
		const [sourceType, providerId] = provider;
		if (!options.owner || !options.repository) {
			throw usageError(`--${sourceType}-id needs --owner and --repository`);
		}
		return {
			...base,
			sourceType,
			[`${sourceType}Id`]: providerId,
			owner: options.owner,
			repository: options.repository,
			branch: options.branch ?? null,
		};
	}

	if (options.gitUrl) {
		return {
			...base,
			sourceType: "git",
			gitUrl: options.gitUrl,
			gitBranch: options.branch ?? null,
			customGitSSHKeyId: options.sshKeyId ?? null,
		};
	}

	throw usageError(
		"Provide a source: --docker-image, --git-url, or --github-id/--gitlab-id/--bitbucket-id/--gitea-id with --owner and --repository",
	);
}

/** Add the hand-written verbs to the generated `app` group. */
export function augmentAppCommand(app: Command): Command {
	addOutputOptions(
		app
			.command("update-source")
			.description("Point an application at a Docker image or a git repository")
			.argument("<applicationId>", "Application ID")
			.option("--docker-image <ref>", "Deploy this image (e.g. traefik/whoami:v1.10.1)")
			.option("--registry-id <id>", "Private registry credential for the image")
			.option("--git-url <url>", "Plain git remote (ssh or https)")
			.option("--branch <branch>", "Branch to build")
			.option("--ssh-key-id <id>", "SSH key for a private git remote")
			.option("--github-id <id>", "Connected GitHub provider ID")
			.option("--gitlab-id <id>", "Connected GitLab provider ID")
			.option("--bitbucket-id <id>", "Connected Bitbucket provider ID")
			.option("--gitea-id <id>", "Connected Gitea provider ID")
			.option("--owner <owner>", "Repository owner (provider sources)")
			.option("--repository <name>", "Repository name (provider sources)")
			.option("--build-path <path>", "Sub-directory to build from")
			.option("--watch-paths <globs>", "Comma-separated paths that trigger auto-deploys")
			.option("--auto-deploy", "Deploy automatically on push"),
	).action(async (applicationId: string, options: SourceOptions) => {
		const updated = await apiPost<Record<string, unknown>>(
			"application.saveSource",
			buildSourceInput(applicationId, options),
		);
		printResult(updated, "Source updated.");
	});

	addOutputOptions(
		app
			.command("build-type")
			.description("Choose the builder (nixpacks, dockerfile, static, buildpacks, railpack)")
			.argument("<applicationId>", "Application ID")
			.requiredOption(
				"--type <type>",
				"nixpacks | dockerfile | static | heroku_buildpacks | paketo_buildpacks | railpack",
			)
			.option("--dockerfile <path>", "Dockerfile path (dockerfile builder)")
			.option("--context <path>", "Build context path (dockerfile builder)")
			.option("--target <stage>", "Build stage (dockerfile builder)")
			.option("--publish-directory <path>", "Output directory (static builder)")
			.option("--no-cache", "Disable the BuildKit layer cache"),
	).action(
		async (
			applicationId: string,
			options: {
				type: string;
				dockerfile?: string;
				context?: string;
				target?: string;
				publishDirectory?: string;
				cache?: boolean;
			},
		) => {
			const updated = await apiPost("application.saveBuildType", {
				applicationId,
				buildType: options.type,
				dockerfile: options.dockerfile ?? null,
				dockerContextPath: options.context ?? null,
				dockerBuildStage: options.target ?? null,
				publishDirectory: options.publishDirectory ?? null,
				useBuildCache: options.cache !== false,
			});
			printResult(updated, "Build type updated.");
		},
	);

	app
		.command("logs")
		.description("Print (and optionally follow) the build/deploy log of an application")
		.argument("<applicationId>", "Application ID")
		.option("-f, --follow", "Follow until the latest deployment finishes")
		.action(async (applicationId: string, options: { follow?: boolean }) => {
			await followDeploymentLogs({ applicationId, follow: Boolean(options.follow) });
		});

	addOutputOptions(
		app
			.command("status")
			.description("Compact status of an application: state, replicas, source and domains")
			.argument("<applicationId>", "Application ID"),
	).action(async (applicationId: string) => {
		const [application, domains] = await Promise.all([
			apiGet<Record<string, unknown>>("application.one", { applicationId }),
			apiGet<Array<{ host: string }>>("domain.byApplication", { applicationId }).catch(() => []),
		]);
		printRecord({
			applicationId: application.applicationId,
			name: application.name,
			appName: application.appName,
			status: application.status,
			sourceType: application.sourceType,
			buildType: application.buildType,
			replicas: application.replicas,
			domains: domains.map((domain) => domain.host).join(", "),
		});
	});

	app
		.command("upload")
		.description("Upload the source archive of a drop (zip upload) application")
		.argument("<applicationId>", "Application ID")
		.argument("<archive>", "Path to a .zip of the project")
		.option("--deploy", "Queue a deployment once the archive is stored")
		.action(async (applicationId: string, archive: string, options: { deploy?: boolean }) => {
			const { readFile } = await import("node:fs/promises");
			let body: Buffer;
			try {
				body = await readFile(archive);
			} catch {
				throw usageError(`Cannot read ${archive}`);
			}
			const result = await apiUpload<{ bytes: number }>(
				`api/applications/${encodeURIComponent(applicationId)}/source`,
				body,
			);
			printResult({ applicationId, bytes: result.bytes }, `Uploaded ${result.bytes} bytes.`);
			if (options.deploy) {
				const deployment = await apiPost<{ deploymentId: string }>("application.deploy", {
					applicationId,
				});
				printResult(
					{ deploymentId: deployment.deploymentId },
					`Deployment ${deployment.deploymentId} queued.`,
				);
			}
		});

	addServiceEnvCommands(app, "app", "<applicationId>", "Application ID");

	return app;
}
