import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { execAsync } from "../../utils/exec";
import { CONTAINER_LIST_COMMAND } from "./containers";

// No daemon or socket is used. CI supplies the real CLI; the fake Engine rejects
// size probes exactly as a stale containerd snapshot does in production.
it.skipIf(process.env.NIXPLOY_TEST_DOCKER_CLI !== "1")(
	"lists healthy and dead tasks even when Docker's size endpoint fails",
	async () => {
		const requestedSizes: Array<string | null> = [];
		const server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (url.pathname.endsWith("/_ping")) {
				res.setHeader("Api-Version", "1.44");
				res.end("OK");
				return;
			}
			res.setHeader("Content-Type", "application/json");
			if (!url.pathname.endsWith("/containers/json")) {
				res.writeHead(404).end("{}");
				return;
			}
			requestedSizes.push(url.searchParams.get("size"));
			if (["1", "true"].includes(url.searchParams.get("size") ?? "")) {
				res.writeHead(500).end(
					JSON.stringify({
						message: `rw layer snapshot not found for container ${"a".repeat(64)}`,
					}),
				);
				return;
			}
			res.end(
				JSON.stringify(
					["running", "dead"].map((state, index) => ({
						Id: (index ? "a" : "b").repeat(64),
						Names: [index ? "/old-task" : "/healthy-app"],
						Image: "alpine:latest",
						ImageID: `sha256:${"c".repeat(64)}`,
						Command: "sleep 60",
						Created: 1720000000,
						Ports: [],
						Labels: {},
						State: state,
						Status: state === "running" ? "Up 1 hour" : "Dead",
						HostConfig: { NetworkMode: "bridge" },
						NetworkSettings: { Networks: {} },
						Mounts: [],
					})),
				),
			);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const env = {
				DOCKER_HOST: `tcp://127.0.0.1:${(server.address() as AddressInfo).port}`,
				DOCKER_API_VERSION: "1.44",
				DOCKER_CONTEXT: "",
				DOCKER_TLS_VERIFY: "",
			};
			await expect(
				execAsync("docker ps -a --format '{{json .}}'", { env, timeout: 5_000 }),
			).rejects.toThrow("rw layer snapshot not found");
			const output = await execAsync(CONTAINER_LIST_COMMAND, { env, timeout: 5_000 });
			const rows = output
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(rows.map((row) => [row.Names, row.State])).toEqual([
				["healthy-app", "running"],
				["old-task", "dead"],
			]);
			expect(requestedSizes).toHaveLength(2);
			expect(["1", "true"]).toContain(requestedSizes[0]);
			expect(["1", "true"]).not.toContain(requestedSizes[1]);
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	},
	15_000,
);
