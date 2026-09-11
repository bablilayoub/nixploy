import { z } from "zod";

/**
 * Zod shapes for the per-application Docker Swarm overrides stored as jsonb
 * (`updateConfigSwarm`, `rollbackConfigSwarm`, `restartPolicySwarm`,
 * `modeSwarm`, `labelsSwarm`, `networkSwarm`). They mirror the Engine API
 * objects that `buildApplicationSwarmSpec` (`modules/application/service.ts`)
 * passes through verbatim, so keys are PascalCase and durations are
 * nanoseconds — exactly what `docker service inspect` prints. Every object is
 * `.strict()` so a typo (`parallelism`, `Paralellism`) is rejected at the
 * router instead of being silently ignored by the engine.
 */

/** Nanoseconds; 0 disables the delay / monitor window. Capped at 24 h. */
const nanoseconds = z
	.number()
	.int()
	.min(0)
	.max(24 * 60 * 60 * 1e9);

const updateOrderSchema = z.enum(["start-first", "stop-first"]);

/** `UpdateConfig` for rolling updates: failure may roll back. */
export const updateConfigSwarmSchema = z
	.object({
		Parallelism: z.number().int().min(0).max(1000).optional(),
		Delay: nanoseconds.optional(),
		FailureAction: z.enum(["continue", "pause", "rollback"]).optional(),
		Monitor: nanoseconds.optional(),
		MaxFailureRatio: z.number().min(0).max(1).optional(),
		Order: updateOrderSchema.optional(),
	})
	.strict();

/** `RollbackConfig`: same shape, but a failed rollback cannot roll back again. */
export const rollbackConfigSwarmSchema = z
	.object({
		Parallelism: z.number().int().min(0).max(1000).optional(),
		Delay: nanoseconds.optional(),
		FailureAction: z.enum(["continue", "pause"]).optional(),
		Monitor: nanoseconds.optional(),
		MaxFailureRatio: z.number().min(0).max(1).optional(),
		Order: updateOrderSchema.optional(),
	})
	.strict();

/** `TaskTemplate.RestartPolicy`. `MaxAttempts: 0` means unlimited. */
export const restartPolicySwarmSchema = z
	.object({
		Condition: z.enum(["none", "on-failure", "any"]).optional(),
		Delay: nanoseconds.optional(),
		MaxAttempts: z.number().int().min(0).max(1000).optional(),
		Window: nanoseconds.optional(),
	})
	.strict();

/**
 * `Mode`: replicated (N tasks) or global (one task per node). Replicas here
 * override the `replicas` column when the mode object is stored.
 */
export const modeSwarmSchema = z.union([
	z
		.object({
			Replicated: z.object({ Replicas: z.number().int().min(0).max(1000) }).strict(),
		})
		.strict(),
	z.object({ Global: z.object({}).strict() }).strict(),
]);

/** Docker label keys: reverse-DNS style; Traefik keys are refused (Nixploy owns routing). */
const labelKeySchema = z
	.string()
	.min(1)
	.max(255)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.\-/]*$/, "Label keys may contain letters, digits, . _ - /")
	.refine((key) => !key.toLowerCase().startsWith("traefik."), {
		message: "traefik.* labels are managed by Nixploy and cannot be set here",
	});

export const MAX_SWARM_LABELS = 64;

/** `Labels` on the service spec (not the containers). */
export const labelsSwarmSchema = z
	.record(labelKeySchema, z.string().max(4096))
	.refine((labels) => Object.keys(labels).length <= MAX_SWARM_LABELS, {
		message: `At most ${MAX_SWARM_LABELS} labels`,
	});

/**
 * Extra overlay networks. Only attachable `nixploy-*` networks are accepted
 * (`sanitizeNetworkAttachments` enforces the same rule at spec time); the
 * shared `nixploy-network` is always attached and does not need listing.
 */
export const swarmNetworkTargetSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^nixploy-[a-zA-Z0-9_.-]+$/, "Only attachable networks named nixploy-* can be joined");

export const MAX_SWARM_NETWORKS = 16;

export const networkSwarmSchema = z
	.array(
		z
			.object({
				Target: swarmNetworkTargetSchema,
				Aliases: z.array(z.string().min(1).max(64)).max(16).optional(),
			})
			.strict(),
	)
	.max(MAX_SWARM_NETWORKS, { message: `At most ${MAX_SWARM_NETWORKS} networks` });

export type UpdateConfigSwarm = z.infer<typeof updateConfigSwarmSchema>;
export type RollbackConfigSwarm = z.infer<typeof rollbackConfigSwarmSchema>;
export type RestartPolicySwarm = z.infer<typeof restartPolicySwarmSchema>;
export type ModeSwarm = z.infer<typeof modeSwarmSchema>;
export type LabelsSwarm = z.infer<typeof labelsSwarmSchema>;
export type NetworkSwarm = z.infer<typeof networkSwarmSchema>;
