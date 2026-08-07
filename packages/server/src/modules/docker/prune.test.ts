import { describe, expect, it, vi } from "vitest";
import { pruneUnusedVolumes } from "./prune";

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
});
