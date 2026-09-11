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
 * Extra overlay networks **on top of** the two Nixploy derives itself: the
 * environment's private overlay (always) and the shared `nixploy-network`
 * (only while the service has a domain). Neither can be named here —
 * `sanitizeNetworkAttachments` seeds them and ignores any attempt to re-add
 * the shared one, so a service without a route can never put itself next to
 * the panel.
 *
 * What remains is the platform namespace (`nixploy-*`), which reaches
 * infrastructure no tenant should join: `nixploy.networkSwarm` is therefore
 * gated on the **instance admin** role in `routers/application.ts`.
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

/* ── container hardening overrides ───────────────────────────────────────── */

/** Linux capability name without the `CAP_` prefix (`NET_ADMIN`, `SYS_TIME`). */
const capabilityNameSchema = z
	.string()
	.min(2)
	.max(32)
	.regex(/^[A-Z][A-Z0-9_]*$/, "Capabilities are upper-case names without the CAP_ prefix")
	// The engine wants the bare name; accepting both spellings would make the
	// baseline comparison in `relaxesContainerHardening` miss `CAP_SYS_ADMIN`.
	.refine((cap) => !cap.startsWith("CAP_"), "Drop the CAP_ prefix (SYS_ADMIN, not CAP_SYS_ADMIN)");

/** `security_opt` values the engine understands and we are willing to accept. */
const securityOptSchema = z.enum([
	"no-new-privileges:true",
	"no-new-privileges:false",
	"seccomp=unconfined",
	"apparmor=unconfined",
]);

export const MAX_SWARM_CAPABILITIES = 16;

/**
 * Per-service relaxation of the baseline container hardening
 * (`deployment/swarm.ts`: `CapabilityDrop: [ALL]` + a minimal add-set,
 * `NoNewPrivileges`, `Pids` 1024). Everything here weakens the sandbox, so
 * the router requires the **instance admin** role — an org owner must not be
 * able to hand its own workload `SYS_ADMIN` on a shared node.
 */
export const privilegesSwarmSchema = z
	.object({
		capabilityAdd: z.array(capabilityNameSchema).max(MAX_SWARM_CAPABILITIES).optional(),
		capabilityDrop: z.array(capabilityNameSchema).max(64).optional(),
		securityOpt: z.array(securityOptSchema).max(4).optional(),
		pidsLimit: z.number().int().min(1).max(16384).optional(),
	})
	.strict();

export type PrivilegesSwarm = z.infer<typeof privilegesSwarmSchema>;

/** Capabilities the baseline already grants — asking for them changes nothing. */
const BASELINE_CAPABILITIES = new Set([
	"CHOWN",
	"DAC_OVERRIDE",
	"FOWNER",
	"KILL",
	"NET_BIND_SERVICE",
	"SETGID",
	"SETUID",
]);

/**
 * Whether an override actually weakens the sandbox — an extra capability
 * beyond the baseline, a `security_opt` that turns a confinement off, a
 * narrower `CapabilityDrop` than `ALL`, or a raised pids ceiling.
 *
 * A no-op override (re-stating the baseline) stays available to org admins;
 * anything else is instance-admin only.
 */
export function relaxesContainerHardening(value: PrivilegesSwarm | null | undefined): boolean {
	if (!value) return false;
	if (value.capabilityAdd?.some((cap) => !BASELINE_CAPABILITIES.has(cap))) return true;
	if (value.capabilityDrop && !value.capabilityDrop.includes("ALL")) return true;
	if (value.securityOpt?.some((opt) => opt !== "no-new-privileges:true")) return true;
	if (value.pidsLimit !== undefined && value.pidsLimit > 1024) return true;
	return false;
}

export type UpdateConfigSwarm = z.infer<typeof updateConfigSwarmSchema>;
export type RollbackConfigSwarm = z.infer<typeof rollbackConfigSwarmSchema>;
export type RestartPolicySwarm = z.infer<typeof restartPolicySwarmSchema>;
export type ModeSwarm = z.infer<typeof modeSwarmSchema>;
export type LabelsSwarm = z.infer<typeof labelsSwarmSchema>;
export type NetworkSwarm = z.infer<typeof networkSwarmSchema>;
