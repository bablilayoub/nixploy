import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execAsyncRemote } = vi.hoisted(() => ({ execAsyncRemote: vi.fn(async () => "") }));
vi.mock("../../utils/exec", () => ({ execAsyncRemote }));

import { getAppBasePath, getBuildCachePath, shellQuote } from "../deployment/paths";
import { removePreviewApplicationFiles } from "./application";

const originalConfig = process.env.NIXPLOY_CONFIG_DIR;
let directory: string | undefined;

afterEach(async () => {
	if (originalConfig === undefined) delete process.env.NIXPLOY_CONFIG_DIR;
	else process.env.NIXPLOY_CONFIG_DIR = originalConfig;
	if (directory) await rm(directory, { recursive: true, force: true });
	directory = undefined;
	vi.clearAllMocks();
});

describe("preview application files", () => {
	it("removes its checkout and cache while preserving the parent and deployment logs", async () => {
		directory = await mkdtemp(path.join(tmpdir(), "preview-files-"));
		process.env.NIXPLOY_CONFIG_DIR = directory;
		const preview = "source-app-pr-1";
		const parent = "source-app";
		for (const app of [preview, parent]) {
			for (const target of [getAppBasePath(app), getBuildCachePath(app)]) {
				await mkdir(target, { recursive: true });
				await writeFile(path.join(target, "marker"), app);
			}
		}
		const logs = path.join(directory, "logs", preview);
		await mkdir(logs, { recursive: true });
		await writeFile(path.join(logs, "deployment.log"), "retained history");

		await removePreviewApplicationFiles(preview, null);

		for (const target of [getAppBasePath(preview), getBuildCachePath(preview)]) {
			await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
		}
		for (const target of [getAppBasePath(parent), getBuildCachePath(parent)]) {
			expect(await readFile(path.join(target, "marker"), "utf8")).toBe(parent);
		}
		expect(await readFile(path.join(logs, "deployment.log"), "utf8")).toBe("retained history");
		expect(execAsyncRemote).not.toHaveBeenCalled();
	});

	it("quotes both preview-owned paths on the server that built them", async () => {
		process.env.NIXPLOY_CONFIG_DIR = "/srv/nixploy's state";
		await removePreviewApplicationFiles("source-app-pr-1", "server-1");
		expect(execAsyncRemote).toHaveBeenCalledExactlyOnceWith(
			"server-1",
			`rm -rf -- ${shellQuote("/srv/nixploy's state/applications/source-app-pr-1")} ${shellQuote("/srv/nixploy's state/cache/buildkit/source-app-pr-1")}`,
		);
	});
});
