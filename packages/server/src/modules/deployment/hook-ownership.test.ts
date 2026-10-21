import type Docker from "dockerode";
import { afterEach, expect, it } from "vitest";
import {
	DEPLOYMENT_HOOK_LABEL,
	DEPLOYMENT_HOOK_OWNER_LABEL,
	hookOwnershipToken,
	ownedDeploymentHook,
} from "./hook-ownership";

const previous = process.env.ENCRYPTION_KEYS;
afterEach(() => {
	if (previous === undefined) delete process.env.ENCRYPTION_KEYS;
	else process.env.ENCRYPTION_KEYS = previous;
});
it("keeps cleanup ownership verifiable through the existing signing-key rotation window", () => {
	const old = "11".repeat(32),
		next = "22".repeat(32);
	process.env.ENCRYPTION_KEYS = old;
	const signed = {
		Id: "a".repeat(64),
		Name: "/app-hook-job",
		Config: {
			Entrypoint: ["sh"],
			Labels: {
				[DEPLOYMENT_HOOK_LABEL]: "job",
				[DEPLOYMENT_HOOK_OWNER_LABEL]: hookOwnershipToken("job", "app-hook-job", null),
			},
		},
		HostConfig: { AutoRemove: true },
	} as unknown as Docker.ContainerInspectInfo;
	process.env.ENCRYPTION_KEYS = `${next},${old}`;
	expect(ownedDeploymentHook(signed, null)).toEqual({
		deploymentId: "job",
		containerId: "a".repeat(64),
	});
	process.env.ENCRYPTION_KEYS = next;
	expect(ownedDeploymentHook(signed, null)).toBeNull();
});
it("binds ownership to the full job, exact created name, and target node", () => {
	const token = hookOwnershipToken("job", "app-hook-job", null);
	expect(token).toMatch(/^[a-f0-9]{64}$/);
	expect(hookOwnershipToken("other", "app-hook-job", null)).not.toBe(token);
	expect(hookOwnershipToken("job", "renamed", null)).not.toBe(token);
	expect(hookOwnershipToken("job", "app-hook-job", "remote")).not.toBe(token);
});
