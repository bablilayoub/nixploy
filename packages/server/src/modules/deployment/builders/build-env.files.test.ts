import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The file side of the build-env helpers: values reach the build through a
 * 0600 file on the target server, only NAMES reach argv, and the file is
 * removed even when the build throws (security audit 2.4).
 */

const written = vi.hoisted(() => ({
	files: [] as Array<{ path: string; content: string; mode?: string }>,
}));

vi.mock("../docker", () => ({
	writeFileTargeted: async (
		_serverId: string | null,
		path: string,
		content: string | Buffer,
		mode?: string,
	) => {
		written.files.push({ path, content: String(content), mode });
	},
}));

import { withBuildArgFlags, withEnvFileFlag, withSourcedBuildEnv } from "./build-env";

const makeCtx = () => {
	const commands: string[] = [];
	return {
		commands,
		ctx: {
			serverId: null,
			logger: { line: () => {} } as never,
			run: async (command: string) => {
				commands.push(command);
			},
			step: async () => {},
		},
	};
};

beforeEach(() => {
	written.files = [];
});

describe("withSourcedBuildEnv", () => {
	it("writes a 0600 file, passes only names, and removes the file", async () => {
		const { ctx, commands } = makeCtx();
		await withSourcedBuildEnv(ctx, "api", ["TOKEN=super-secret", "PORT=3000"], async (env) => {
			expect(env.flags).toBe(" --env 'TOKEN' --env 'PORT'");
			expect(env.flags).not.toContain("super-secret");
			expect(env.prefix).toMatch(/^set -a && \. '.*build-[0-9a-f]+\.env' && set \+a && $/);
		});

		expect(written.files).toHaveLength(1);
		expect(written.files[0]?.mode).toBe("600");
		expect(written.files[0]?.content).toBe("TOKEN='super-secret'\nPORT='3000'\n");
		expect(commands[0]).toMatch(/^rm -f '.*build-[0-9a-f]+\.env'$/);
	});

	it("removes the file when the build throws", async () => {
		const { ctx, commands } = makeCtx();
		await expect(
			withSourcedBuildEnv(ctx, "api", ["A=1234abcd"], async () => {
				throw new Error("build failed");
			}),
		).rejects.toThrow("build failed");
		expect(commands[0]).toMatch(/^rm -f /);
	});

	it("writes nothing when there is no build env", async () => {
		const { ctx, commands } = makeCtx();
		await withSourcedBuildEnv(ctx, "api", [], async (env) => {
			expect(env).toEqual({ prefix: "", flags: "" });
		});
		expect(written.files).toHaveLength(0);
		expect(commands).toHaveLength(0);
	});
});

describe("withEnvFileFlag", () => {
	it("hands pack a 0600 --env-file and cleans it up", async () => {
		const { ctx, commands } = makeCtx();
		await withEnvFileFlag(ctx, "api", ["TOKEN=super-secret"], async ({ flag, path }) => {
			expect(flag).toMatch(/^ --env-file '.*'$/);
			expect(flag).not.toContain("super-secret");
			expect(path).toBeTruthy();
		});
		expect(written.files[0]?.mode).toBe("600");
		expect(written.files[0]?.content).toBe("TOKEN=super-secret\n");
		expect(commands[0]).toMatch(/^rm -f /);
	});
});

describe("withBuildArgFlags", () => {
	it("splits secret-looking args into BuildKit secrets and the rest into build-args", async () => {
		const { ctx, commands } = makeCtx();
		await withBuildArgFlags(
			ctx,
			"api",
			[
				["NPM_TOKEN", "npm-secret-value"],
				["NODE_ENV", "production"],
			],
			async (flags) => {
				expect(flags.buildArgs).toBe(" --build-arg 'NODE_ENV=production'");
				expect(flags.secretIds).toEqual(["NPM_TOKEN"]);
				expect(flags.secrets).toMatch(/^ --secret id='NPM_TOKEN,src=.*\.secret'$/);
				expect(flags.secrets).not.toContain("npm-secret-value");
			},
		);

		expect(written.files).toHaveLength(1);
		expect(written.files[0]?.content).toBe("npm-secret-value");
		expect(written.files[0]?.mode).toBe("600");
		expect(commands[0]).toMatch(/^rm -f /);
	});
});
