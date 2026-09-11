import { describe, expect, it } from "vitest";
import {
	labelsSwarmSchema,
	modeSwarmSchema,
	networkSwarmSchema,
	privilegesSwarmSchema,
	relaxesContainerHardening,
	restartPolicySwarmSchema,
	rollbackConfigSwarmSchema,
	updateConfigSwarmSchema,
} from "./swarm-overrides";

describe("swarm override schemas", () => {
	it("accepts a docker-shaped UpdateConfig and rejects unknown or lowercase keys", () => {
		expect(
			updateConfigSwarmSchema.parse({
				Parallelism: 2,
				Delay: 10e9,
				FailureAction: "rollback",
				Monitor: 5e9,
				MaxFailureRatio: 0.2,
				Order: "start-first",
			}),
		).toEqual({
			Parallelism: 2,
			Delay: 10e9,
			FailureAction: "rollback",
			Monitor: 5e9,
			MaxFailureRatio: 0.2,
			Order: "start-first",
		});
		expect(updateConfigSwarmSchema.safeParse({ parallelism: 2 }).success).toBe(false);
		expect(updateConfigSwarmSchema.safeParse({ FailureAction: "explode" }).success).toBe(false);
		expect(updateConfigSwarmSchema.safeParse({ Delay: -1 }).success).toBe(false);
	});

	it("does not let a rollback roll back again", () => {
		expect(rollbackConfigSwarmSchema.safeParse({ FailureAction: "rollback" }).success).toBe(false);
		expect(rollbackConfigSwarmSchema.safeParse({ FailureAction: "pause" }).success).toBe(true);
	});

	it("validates restart policies", () => {
		expect(
			restartPolicySwarmSchema.parse({ Condition: "on-failure", MaxAttempts: 3, Window: 120e9 }),
		).toEqual({ Condition: "on-failure", MaxAttempts: 3, Window: 120e9 });
		expect(restartPolicySwarmSchema.safeParse({ Condition: "always" }).success).toBe(false);
		expect(restartPolicySwarmSchema.safeParse({ MaxAttempts: 1.5 }).success).toBe(false);
	});

	it("accepts replicated or global mode only", () => {
		expect(modeSwarmSchema.parse({ Replicated: { Replicas: 3 } })).toEqual({
			Replicated: { Replicas: 3 },
		});
		expect(modeSwarmSchema.parse({ Global: {} })).toEqual({ Global: {} });
		expect(modeSwarmSchema.safeParse({ Replicated: { Replicas: -1 } }).success).toBe(false);
		expect(modeSwarmSchema.safeParse({ Global: {}, Replicated: { Replicas: 1 } }).success).toBe(
			false,
		);
		expect(modeSwarmSchema.safeParse({ ReplicatedJob: {} }).success).toBe(false);
	});

	it("refuses traefik.* labels and odd keys", () => {
		expect(labelsSwarmSchema.parse({ "com.example.team": "core", tier: "web" })).toEqual({
			"com.example.team": "core",
			tier: "web",
		});
		expect(labelsSwarmSchema.safeParse({ "traefik.enable": "true" }).success).toBe(false);
		expect(labelsSwarmSchema.safeParse({ "Traefik.http.routers.x.rule": "x" }).success).toBe(false);
		expect(labelsSwarmSchema.safeParse({ "bad key": "x" }).success).toBe(false);
		expect(labelsSwarmSchema.safeParse({ "": "x" }).success).toBe(false);
	});

	it("only joins attachable nixploy-* networks", () => {
		expect(networkSwarmSchema.parse([{ Target: "nixploy-internal", Aliases: ["api"] }])).toEqual([
			{ Target: "nixploy-internal", Aliases: ["api"] },
		]);
		expect(networkSwarmSchema.safeParse([{ Target: "ingress" }]).success).toBe(false);
		expect(networkSwarmSchema.safeParse([{ Target: "nixploy-x", Extra: 1 }]).success).toBe(false);
		expect(networkSwarmSchema.safeParse([{ Target: "nixploy-x; rm -rf /" }]).success).toBe(false);
	});
});

describe("container hardening overrides", () => {
	it("accepts a docker-shaped privileges object and rejects typos / raw CAP_ names", () => {
		expect(
			privilegesSwarmSchema.parse({
				capabilityAdd: ["NET_ADMIN"],
				capabilityDrop: ["ALL"],
				securityOpt: ["no-new-privileges:true"],
				pidsLimit: 2048,
			}),
		).toEqual({
			capabilityAdd: ["NET_ADMIN"],
			capabilityDrop: ["ALL"],
			securityOpt: ["no-new-privileges:true"],
			pidsLimit: 2048,
		});
		expect(privilegesSwarmSchema.safeParse({ capabilityAdd: ["CAP_NET_ADMIN"] }).success).toBe(
			false,
		);
		expect(privilegesSwarmSchema.safeParse({ securityOpt: ["seccomp=weird"] }).success).toBe(false);
		expect(privilegesSwarmSchema.safeParse({ capability_add: ["CHOWN"] }).success).toBe(false);
	});

	it("flags only the values that actually weaken the sandbox", () => {
		// Re-stating the baseline changes nothing and stays open to org admins.
		expect(relaxesContainerHardening(null)).toBe(false);
		expect(
			relaxesContainerHardening({
				capabilityAdd: ["CHOWN", "SETUID"],
				capabilityDrop: ["ALL"],
				securityOpt: ["no-new-privileges:true"],
				pidsLimit: 1024,
			}),
		).toBe(false);
		expect(relaxesContainerHardening({ capabilityAdd: ["SYS_ADMIN"] })).toBe(true);
		expect(relaxesContainerHardening({ capabilityDrop: ["NET_RAW"] })).toBe(true);
		expect(relaxesContainerHardening({ securityOpt: ["no-new-privileges:false"] })).toBe(true);
		expect(relaxesContainerHardening({ securityOpt: ["seccomp=unconfined"] })).toBe(true);
		expect(relaxesContainerHardening({ pidsLimit: 8192 })).toBe(true);
	});
});
