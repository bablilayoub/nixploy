import { describe, expect, it } from "vitest";
import type { DockerLogLine } from "./format";
import {
	buildRemoteHarvestCommand,
	ingestContainerLines,
	MAX_LINES_PER_CONTAINER_PASS,
	parseRemoteHarvestOutput,
	resolveContainerOwner,
} from "./harvest";

const wanted = new Set(["shop-a1b2c3", "stack-9f9f9f"]);

describe("runtime log harvest", () => {
	it("maps containers to their service and names them inside a stack", () => {
		expect(
			resolveContainerOwner({ "com.docker.swarm.service.name": "shop-a1b2c3" }, wanted),
		).toEqual({ appName: "shop-a1b2c3", container: null });
		expect(
			resolveContainerOwner(
				{ "com.docker.compose.project": "shop-a1b2c3", "com.docker.compose.service": "web" },
				wanted,
			),
		).toEqual({ appName: "shop-a1b2c3", container: "web" });
		expect(
			resolveContainerOwner(
				{
					"com.docker.stack.namespace": "stack-9f9f9f",
					"com.docker.swarm.service.name": "stack-9f9f9f_api",
				},
				wanted,
			),
		).toEqual({ appName: "stack-9f9f9f", container: "api" });
		expect(resolveContainerOwner({ "com.docker.swarm.service.name": "other" }, wanted)).toBeNull();
	});

	it("keeps only lines newer than the cursor, marks a capped pass and advances the cursor", () => {
		const now = Date.parse("2026-09-19T21:30:00Z");
		const batch = {
			appName: "shop-a1b2c3",
			state: { cursors: { abcdefabcdef: { ts: "2026-09-19T21:29:00.000000005Z", seenAt: 1 } } },
			lines: [] as ReturnType<typeof ingestContainerLines> extends void ? never[] : never[],
			touched: false,
		};
		const raw: DockerLogLine[] = [
			{ ts: "2026-09-19T21:29:00.000000005Z", t: now - 60_000, message: "already stored" },
			{ ts: "2026-09-19T21:29:30.000000000Z", t: now - 30_000, message: "ERROR new" },
		];
		ingestContainerLines(batch as never, "abcdefabcdef", "web", raw, now);
		expect(
			(batch.lines as unknown as Array<{ message: string; level: string }>).map((l) => [
				l.level,
				l.message,
			]),
		).toEqual([["error", "ERROR new"]]);
		expect(batch.state.cursors.abcdefabcdef).toEqual({
			ts: "2026-09-19T21:29:30.000000000Z",
			seenAt: now,
		});

		const capped = Array.from({ length: MAX_LINES_PER_CONTAINER_PASS }, (_, index) => ({
			ts: `2026-09-19T21:29:3${String(index).padStart(1, "0")}.${String(index).padStart(9, "0")}Z`,
			t: now - 20_000 + index,
			message: `line ${index}`,
		}));
		const fresh = { appName: "shop-a1b2c3", state: { cursors: {} }, lines: [], touched: false };
		ingestContainerLines(fresh as never, "123456123456", null, capped, now);
		const first = (fresh.lines as unknown as Array<{ level: string; message: string }>)[0];
		expect(first?.level).toBe("warn");
		expect(first?.message).toMatch(/older lines were dropped/);
	});

	it("builds a per-server script with each container's own cursor and parses its output back", () => {
		const command = buildRemoteHarvestCommand([
			{
				appName: "shop-a1b2c3",
				cursors: { abcdefabcdef: "2026-09-19T21:29:00.000000005Z", "not a cid": "x" },
				defaultSince: "2026-09-19T21:20:00.000Z",
			},
			{ appName: "bad name!", cursors: {}, defaultSince: "2026-09-19T21:20:00.000Z" },
		]);
		expect(command).toContain("echo '==APP==''shop-a1b2c3'");
		expect(command).toContain("abcdefabcdef) s='2026-09-19T21:29:00.000000005Z';;");
		expect(command).not.toContain("not a cid");
		expect(command).not.toContain("bad name");
		expect(command).toContain(`--tail ${MAX_LINES_PER_CONTAINER_PASS}`);

		const parsed = parseRemoteHarvestOutput(
			[
				"==APP==shop-a1b2c3",
				"==CID==abcdefabcdef|web|",
				"2026-09-19T21:29:30.000000000Z listening",
				"  continuation",
				"==CID==bad|x|",
				"2026-09-19T21:29:31.000000000Z ignored",
				"==CID==123456123456||shop-a1b2c3_api",
				"2026-09-19T21:29:32.000000000Z from a stack",
				"==APP==nope!",
				"==CID==abcdefabcdef||",
				"2026-09-19T21:29:33.000000000Z ignored too",
			].join("\n"),
		);
		expect(parsed).toEqual([
			{
				appName: "shop-a1b2c3",
				containers: [
					{
						id: "abcdefabcdef",
						name: "web",
						lines: [
							{
								ts: "2026-09-19T21:29:30.000000000Z",
								t: Date.parse("2026-09-19T21:29:30Z"),
								message: "listening\n  continuation",
							},
						],
					},
					{
						id: "123456123456",
						name: "api",
						lines: [
							{
								ts: "2026-09-19T21:29:32.000000000Z",
								t: Date.parse("2026-09-19T21:29:32Z"),
								message: "from a stack",
							},
						],
					},
				],
			},
		]);
	});
});
