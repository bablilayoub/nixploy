/**
 * The named phases a deploy passes through.
 *
 * Written onto `deployment.current_step` as the worker advances, so a failure
 * can say *where* it failed without anyone parsing the build log. The log is
 * free text — it always was — and a machine-readable "failing step" that
 * depends on matching English sentences is a promise that breaks the first
 * time someone rewords a line.
 *
 * Import-free on purpose: the panel renders these labels, and `modules/mcp`
 * and the CLI describe them.
 */

/**
 * Order is the order they run. An application skips `render`, a compose
 * service skips `push`, and every kind skips the steps its configuration does
 * not ask for (no hooks, no push registry) — a step is recorded when it
 * starts, so a missing one simply never appears.
 */
export const DEPLOY_STEPS = [
	"source",
	"render",
	"build",
	"pre_deploy",
	"push",
	"rollout",
	"converge",
	"post_deploy",
	"route",
	"finalize",
] as const;

export type DeployStep = (typeof DEPLOY_STEPS)[number];

/** Human label for a step (the panel's failure line, `nixploy` output). */
export const DEPLOY_STEP_LABELS: Record<DeployStep, string> = {
	source: "Fetching the source",
	render: "Rendering the compose file",
	build: "Building the image",
	pre_deploy: "Running the pre-deploy command",
	push: "Pushing to the registry",
	rollout: "Rolling out to Swarm",
	converge: "Waiting for the service to start",
	post_deploy: "Running the post-deploy command",
	route: "Writing the routing configuration",
	finalize: "Finishing up",
};

const STEP_SET: ReadonlySet<string> = new Set(DEPLOY_STEPS);

/** Runtime guard for a value read back from the database or an API caller. */
export const isDeployStep = (value: unknown): value is DeployStep =>
	typeof value === "string" && STEP_SET.has(value);

/**
 * Label for a step, tolerating one this build does not know — an older panel
 * reading a newer instance's row still renders something useful.
 */
export const deployStepLabel = (step: string): string =>
	isDeployStep(step) ? DEPLOY_STEP_LABELS[step] : step.replace(/_/g, " ");
