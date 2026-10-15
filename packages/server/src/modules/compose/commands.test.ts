import { describe, expect, it } from "vitest";
import {
	buildComposeDeployCommand,
	buildComposeDownCommand,
	buildComposeFallbackDownCommand,
	buildComposeStopCommand,
	cleanEnvPrefix,
	composeSuffix,
	deployedServiceCandidates,
	deployedServiceName,
	sharedNetworkAlias,
	sharedNetworkConnectCommand,
	sharedNetworkServiceUpdateCommand,
	sourceComposeServiceName,
	stackServiceCandidates,
	stackServiceName,
	traefikAppName,
} from "./commands";

const files = { composeFilePath: "/etc/nixploy/compose/my-app/docker-compose.nixploy.yml" };
const composeRow = { appName: "my-app", composeType: "docker-compose" as const };
const stackRow = { appName: "my-app", composeType: "stack" as const };

describe("buildComposeDeployCommand", () => {
	it("deploys the rendered file directly, under a clean environment", () => {
		const command = buildComposeDeployCommand(composeRow, files);
		expect(command.startsWith(cleanEnvPrefix())).toBe(true);
		expect(command).toContain(
			"docker compose -p 'my-app' -f '/etc/nixploy/compose/my-app/docker-compose.nixploy.yml' --env-file /dev/null up -d --remove-orphans",
		);
	});

	it("feeds the rendered file straight to docker stack deploy (no compose config pipe)", () => {
		const command = buildComposeDeployCommand(stackRow, files);
		expect(command).toContain(
			"docker stack deploy --with-registry-auth --prune -c '/etc/nixploy/compose/my-app/docker-compose.nixploy.yml' 'my-app'",
		);
		expect(command).not.toContain("compose config");
		expect(command).not.toContain("set -a");
	});

	it("never leaks the panel environment to the docker CLI", () => {
		const prefix = cleanEnvPrefix();
		expect(prefix.startsWith("env -i ")).toBe(true);
		expect(prefix).toContain('PATH="$PATH"');
		expect(prefix).toContain('HOME="$HOME"');
		expect(prefix).toContain('DOCKER_HOST="$DOCKER_HOST"');
		expect(prefix).not.toContain("DATABASE_URL");
		expect(prefix).not.toContain("ENCRYPTION_KEY");
	});

	it("shell-quotes appName and paths", () => {
		const command = buildComposeDeployCommand(
			{ appName: "it's", composeType: "docker-compose" },
			{ composeFilePath: "/tmp/a b/file.yml" },
		);
		expect(command).toContain(`-p 'it'\\''s'`);
		expect(command).toContain("-f '/tmp/a b/file.yml'");
	});
});

describe("stop / down commands", () => {
	it("uses the rendered file for compose and stack rm for stacks", () => {
		expect(buildComposeStopCommand(composeRow, files)).toContain("--env-file /dev/null stop");
		expect(buildComposeStopCommand(stackRow, files)).toBe("docker stack rm 'my-app'");
		expect(buildComposeDownCommand(composeRow, files)).toContain(
			"--env-file /dev/null down --remove-orphans",
		);
		expect(buildComposeDownCommand(stackRow, files)).toBe("docker stack rm 'my-app'");
	});

	it("falls back to a name-only teardown for both types", () => {
		expect(buildComposeFallbackDownCommand(composeRow)).toBe(
			"docker compose -p 'my-app' down --remove-orphans",
		);
		expect(buildComposeFallbackDownCommand(stackRow)).toBe("docker stack rm 'my-app'");
	});
});

describe("isolation suffix naming", () => {
	const isolated = {
		appName: "shop",
		composeType: "docker-compose" as const,
		isolatedDeployment: true,
		suffix: "a1b2c3",
	};

	it("only applies the suffix when isolation is enabled", () => {
		expect(composeSuffix(isolated)).toBe("a1b2c3");
		expect(composeSuffix({ ...isolated, isolatedDeployment: false })).toBe("");
		expect(composeSuffix({ ...isolated, suffix: "" })).toBe("");
	});

	it("keeps Traefik target and shared-network alias in sync with the renamed service", () => {
		expect(traefikAppName(isolated, "web")).toBe("shop-web-a1b2c3");
		expect(sharedNetworkAlias(isolated, "web")).toBe("shop-web-a1b2c3");
		expect(traefikAppName({ ...isolated, composeType: "stack" }, "web")).toBe("shop_web-a1b2c3");
		expect(stackServiceName({ ...isolated, composeType: "stack" }, "web")).toBe(
			"shop_shop-web-a1b2c3",
		);
		expect(traefikAppName({ appName: "shop", composeType: "docker-compose" }, "web")).toBe(
			"shop-web",
		);
		expect(traefikAppName({ appName: "shop", composeType: "stack" }, null)).toBe("shop_");
	});

	it("qualifies both engines while separating route aliases from physical Swarm identities", () => {
		expect(deployedServiceName(composeRow, "db")).toBe("my-app-db");
		expect(deployedServiceName(isolated, "db")).toBe("shop-db-a1b2c3");
		expect(deployedServiceName(stackRow, "db")).toBe("my-app-db");
		expect(deployedServiceCandidates(isolated, "db")).toEqual(["shop-db-a1b2c3", "db-a1b2c3"]);
		expect(deployedServiceCandidates(stackRow, "db")).toEqual(["my-app-db", "db"]);
		expect(stackServiceCandidates(stackRow, "db")).toEqual(["my-app_my-app-db", "my-app_db"]);
		expect(sourceComposeServiceName("shop-web", "web")).toBe("web");
		// A legacy raw source key may already start with its project name.
		expect(sourceComposeServiceName("shop-web")).toBe("shop-web");
	});
});

describe("runtime shared-network attach commands", () => {
	it("connects a compose container with the Traefik alias", () => {
		expect(sharedNetworkConnectCommand(composeRow, "web", "abc123")).toBe(
			"docker network connect --alias 'my-app-web' 'nixploy-network' 'abc123'",
		);
	});

	it("adds the network with alias to a swarm service", () => {
		expect(sharedNetworkServiceUpdateCommand(stackRow, "web")).toBe(
			"docker service update --network-add 'name=nixploy-network,alias=my-app-web,alias=my-app_web' 'my-app_my-app-web'",
		);
		expect(sharedNetworkServiceUpdateCommand(stackRow, "web", "my-app_web")).toContain(
			"'my-app_web'",
		);
	});
});
