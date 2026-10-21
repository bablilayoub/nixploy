import { describe, expect, it } from "vitest";
import { discoverSecretColumns } from "../../scripts/rotate-encryption-key";
import { composeEnvMap } from "../compose/interpolate";
import { parseEnv as runtimeParse } from "../deployment/env";
import { assessConvergence, DEPLOYMENT_REVISION_LABEL } from "../deployment/swarm";
import { resolveEnvironmentLayers, toEnvString } from "../projects/env-resolution";
import { configurationFingerprint, matchesConfigurationReview } from "./fingerprint";

it("uses one quote/escape/empty precedence model for preview, app hooks and Compose", () => {
	const effective = resolveEnvironmentLayers(
		{
			organization:
				'ORG="space # literal"\nEMPTY=org\nQUOTE=\'"literal quotes"\'\nSLASH="left\\\\nright"',
			project: "LEVEL=project\nEMPTY=project",
			environment: "LEVEL=environment",
		},
		'EMPTY=\nLEVEL=service\nMULTI="one\\ntwo"',
	);
	const serialized = toEnvString(effective.values);
	expect(Object.fromEntries(runtimeParse(serialized))).toEqual(effective.values);
	expect(composeEnvMap(serialized)).toEqual(effective.values);
	expect(effective.values).toMatchObject({
		ORG: "space # literal",
		EMPTY: "",
		QUOTE: '"literal quotes"',
		LEVEL: "service",
		MULTI: "one\ntwo",
		SLASH: "left\\nright",
	});
	expect(effective.origins).toMatchObject({
		ORG: "organization",
		EMPTY: "service",
		LEVEL: "service",
	});
});

it("binds every review value to a keyed opaque digest, with stable object ordering", () => {
	const token = configurationFingerprint({ scope: "a", env: { SECRET: "canary", EMPTY: "" } });
	expect(token).toMatch(/^[a-f0-9]{64}$/);
	expect(token).not.toContain("canary");
	expect(configurationFingerprint({ env: { EMPTY: "", SECRET: "canary" }, scope: "a" })).toBe(
		token,
	);
	expect(
		matchesConfigurationReview(
			token,
			configurationFingerprint({ scope: "a", env: { SECRET: "changed", EMPTY: "" } }),
		),
	).toBe(false);
	expect(matchesConfigurationReview(token, "bad")).toBe(false);
});

it("includes every new encrypted field in automatic key rotation", () => {
	const columns = discoverSecretColumns().filter((column) =>
		["organization_environment", "deployment_environment_snapshot"].includes(column.table),
	);
	expect(columns.map((column) => `${column.table}.${column.column}`)).toEqual([
		"deployment_environment_snapshot.build_args",
		"deployment_environment_snapshot.runtime_env",
		"deployment_environment_snapshot.service_env",
		"organization_environment.env",
	]);
});

describe("new revision convergence", () => {
	const task = (revision: string, state: string, desired = "running") => ({
		Spec: { ContainerSpec: { Labels: { [DEPLOYMENT_REVISION_LABEL]: revision } } },
		Status: { State: state },
		DesiredState: desired,
	});
	it("never accepts an old healthy replica or an incomplete new replica set", () => {
		const target = { deploymentId: "new", replicas: 2 };
		expect(assessConvergence([task("old", "running"), task("new", "starting")], target)).toEqual({
			state: "pending",
		});
		expect(assessConvergence([task("old", "running"), task("new", "running")], target)).toEqual({
			state: "pending",
		});
		expect(assessConvergence([task("new", "running"), task("new", "running")], target)).toEqual({
			state: "running",
		});
	});
	it("does not count shutdown tasks or another revision's failure history", () => {
		const target = { deploymentId: "new", replicas: 1 };
		expect(
			assessConvergence(
				[
					task("new", "running", "shutdown"),
					task("old", "failed"),
					task("old", "failed"),
					task("old", "failed"),
				],
				target,
			),
		).toEqual({ state: "pending" });
	});
	it("requires every desired global task to carry the new revision", () => {
		const target = { deploymentId: "new", replicas: null };
		expect(assessConvergence([task("new", "running"), task("old", "running")], target)).toEqual({
			state: "pending",
		});
		expect(assessConvergence([task("new", "running"), task("new", "running")], target)).toEqual({
			state: "running",
		});
	});
});

it("reuses exact historic Compose variables and an explicitly empty build-args snapshot", async () => {
	const { environmentForComposeRollback } = await import("../deployment/environment-snapshot");
	const current = {
		runtimeEnv: "SHARED=changed\nAPP=draft",
		serviceEnv: "APP=draft",
		buildArgs: "TOKEN=changed",
		sourceFingerprint: "current",
	};
	const historical = {
		...current,
		deploymentId: "old",
		runtimeEnv: "SHARED=old\nAPP=old",
		serviceEnv: "APP=old",
		buildArgs: null,
		releaseId: null,
		createdAt: new Date(),
	};
	const result = environmentForComposeRollback(
		{ deploymentId: "old", mergedEnv: historical.runtimeEnv, serviceEnv: historical.serviceEnv },
		current,
		historical,
	);
	expect(result.runtimeEnv).toBe(historical.runtimeEnv);
	expect(result.serviceEnv).toBe("APP=old");
	expect(result.buildArgs).toBeNull();
	expect(result.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
	expect(
		environmentForComposeRollback(
			{ deploymentId: "legacy", mergedEnv: null, serviceEnv: null },
			current,
			null,
		),
	).toMatchObject({ runtimeEnv: current.runtimeEnv, serviceEnv: "", buildArgs: current.buildArgs });
});
