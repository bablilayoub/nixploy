import { describe, expect, it, vi } from "vitest";
import { isGuardedVolumeName, pruneUnusedVolumes } from "./prune";

describe("pruneUnusedVolumes", () => {
	it("removes unused named volumes and skips protected + in-use", async () => {
		const removed: string[] = [];
		const run = vi.fn(async (command: string) => {
			if (command === "docker ps -aq") return "c1";
			if (command.startsWith("docker inspect")) return "in-use-vol\n";
			if (command.startsWith("docker volume ls")) {
				return [
					JSON.stringify({ Name: "orphan-named" }),
					JSON.stringify({ Name: "in-use-vol" }),
					JSON.stringify({ Name: "nixploy-postgres-data" }),
					JSON.stringify({ Name: "another-orphan" }),
				].join("\n");
			}
			if (command.startsWith("docker volume rm")) {
				const match = command.match(/'([^']+)'/);
				if (match?.[1]) removed.push(match[1]);
				return "";
			}
			throw new Error(`unexpected: ${command}`);
		});

		const output = await pruneUnusedVolumes(run);

		expect(removed).toEqual(["orphan-named", "another-orphan"]);
		expect(output).toContain("orphan-named");
		expect(output).toContain("another-orphan");
		expect(output).toContain("Skipped protected: nixploy-postgres-data");
		expect(output).not.toContain("in-use-vol\n");
	});

	it("handles hosts with no containers", async () => {
		const run = vi.fn(async (command: string) => {
			if (command === "docker ps -aq") return "";
			if (command.startsWith("docker volume ls")) {
				return JSON.stringify({ Name: "lonely" });
			}
			if (command.startsWith("docker volume rm")) return "";
			throw new Error(`unexpected: ${command}`);
		});

		const output = await pruneUnusedVolumes(run);
		expect(output).toContain("lonely");
		expect(output).toContain("Total: 1 volume(s)");
	});

	it("keeps volumes owned by service rows and mounted by swarm services", async () => {
		const removed: string[] = [];
		const run = vi.fn(async (command: string) => {
			if (command === "docker ps -aq") return "";
			if (command === "docker service ls -q") return "svc1\nsvc2";
			if (command.startsWith("docker service inspect")) return "swarm-mounted\n";
			if (command.startsWith("docker volume ls")) {
				return [
					JSON.stringify({ Name: "stopped-pg-data" }),
					JSON.stringify({ Name: "swarm-mounted" }),
					JSON.stringify({ Name: "custom-mount" }),
					JSON.stringify({ Name: "mystack_db" }),
					JSON.stringify({ Name: "truly-orphan" }),
				].join("\n");
			}
			if (command.startsWith("docker volume rm")) {
				const match = command.match(/'([^']+)'/);
				if (match?.[1]) removed.push(match[1]);
				return "";
			}
			throw new Error(`unexpected: ${command}`);
		});

		const guard = { names: new Set(["stopped-pg-data", "custom-mount"]), prefixes: ["mystack_"] };
		const output = await pruneUnusedVolumes(run, guard);

		expect(removed).toEqual(["truly-orphan"]);
		expect(output).toContain(
			"Skipped protected: stopped-pg-data, swarm-mounted, custom-mount, mystack_db",
		);
	});

	it("treats a non-manager engine as having no swarm-mounted volumes", async () => {
		const run = vi.fn(async (command: string) => {
			if (command === "docker ps -aq") return "";
			if (command === "docker service ls -q") {
				throw new Error("This node is not a swarm manager");
			}
			if (command.startsWith("docker volume ls")) return JSON.stringify({ Name: "orphan" });
			if (command.startsWith("docker volume rm")) return "";
			throw new Error(`unexpected: ${command}`);
		});
		await expect(pruneUnusedVolumes(run)).resolves.toContain("Total: 1 volume(s)");
	});
});

describe("isGuardedVolumeName", () => {
	const guard = { names: new Set(["app-data"]), prefixes: ["stack_"] };
	it("matches platform volumes, exact service volumes and compose prefixes", () => {
		expect(isGuardedVolumeName("nixploy-postgres-data")).toBe(true);
		expect(isGuardedVolumeName("app-data", guard)).toBe(true);
		expect(isGuardedVolumeName("stack_db", guard)).toBe(true);
		expect(isGuardedVolumeName("stack", guard)).toBe(false);
		expect(isGuardedVolumeName("other", guard)).toBe(false);
		expect(isGuardedVolumeName("app-data")).toBe(false);
	});
});
