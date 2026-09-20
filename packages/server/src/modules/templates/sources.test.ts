import { readFile, stat } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDir } from "../../test-utils/tmpdir";

/**
 * Template-source syncing with the network and the database mocked out: the
 * interesting behaviour is what reaches the CACHE (validated entries only,
 * 0600) and what a failed sync records, not Postgres.
 */

const dir = useTempDir("nixploy-template-sources-");

const updates: Array<Record<string, unknown>> = [];

vi.mock("../deployment/paths", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../deployment/paths")>();
	return { ...actual, getConfigDir: () => dir.path };
});

vi.mock("../../db", () => ({
	db: {
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: () => {
					updates.push(values);
					return Promise.resolve();
				},
			}),
		}),
		query: {
			templateSources: {
				findFirst: () => Promise.resolve(null),
				findMany: () => Promise.resolve([]),
			},
		},
	},
}));

const pinnedFetch = vi.fn();
vi.mock("../../utils/public-url", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../utils/public-url")>();
	return {
		...actual,
		assertSafeOutboundUrl: vi.fn(async (url: string) => ({
			url: new URL(url),
			addresses: ["93.184.216.34"],
			isPrivate: false,
		})),
		pinnedFetch: (...args: unknown[]) => pinnedFetch(...args),
	};
});

const checkCatalogImages = vi.fn();
vi.mock("./images", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./images")>();
	return { ...actual, checkCatalogImages: (...args: unknown[]) => checkCatalogImages(...args) };
});

const {
	getTemplateSourceCachePath,
	listSourcedTemplates,
	parseRemoteTemplateId,
	remoteTemplateId,
	readTemplateSourceReport,
	syncTemplateSource,
} = await import("./sources");

const template = {
	id: "hello",
	name: "Hello",
	compose: "services:\n  app:\n    image: traefik/whoami:v1.10\n",
	suggestedDomain: { serviceName: "app", port: 80 },
};

const row = {
	templateSourceId: "src-1",
	name: "Team catalog",
	url: "https://templates.example.com/index.json",
	kind: "http-json" as const,
	branch: null,
	enabled: true,
	lastSyncAt: null,
	lastError: null,
	templateCount: 0,
	organizationId: "org-1",
	createdAt: new Date(),
};

const jsonResponse = (body: unknown, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	statusText: "",
	body: JSON.stringify(body),
	headers: { get: () => null },
	text: () => JSON.stringify(body),
	json: () => body,
});

beforeEach(() => {
	updates.length = 0;
	pinnedFetch.mockReset();
	checkCatalogImages.mockReset();
	checkCatalogImages.mockResolvedValue([{ image: "traefik/whoami:v1.10", ok: true }]);
});

describe("syncTemplateSource", () => {
	it("caches the validated entries and records the count", async () => {
		pinnedFetch.mockResolvedValue(jsonResponse([template]));
		const result = await syncTemplateSource(row);

		expect(result.templateCount).toBe(1);
		expect(result.rejected).toEqual([]);
		expect(result.imageWarnings).toEqual([]);
		expect(updates.at(-1)).toMatchObject({ lastError: null, templateCount: 1 });

		const cached = JSON.parse(await readFile(getTemplateSourceCachePath("src-1"), "utf8"));
		expect(cached.templates).toHaveLength(1);
		expect(cached.templates[0].id).toBe("hello");
	});

	it("writes the cache 0600 — compose bodies carry example credentials", async () => {
		pinnedFetch.mockResolvedValue(jsonResponse([template]));
		await syncTemplateSource(row);
		const info = await stat(getTemplateSourceCachePath("src-1"));
		expect(info.mode & 0o777).toBe(0o600);
	});

	it("keeps the good entries and reports the bad ones", async () => {
		pinnedFetch.mockResolvedValue(
			jsonResponse([template, { id: "BROKEN ID", name: "x", compose: "y" }]),
		);
		const result = await syncTemplateSource(row);
		expect(result.templateCount).toBe(1);
		expect(result.rejected).toHaveLength(1);
		expect(await readTemplateSourceReport("src-1")).toMatchObject({
			rejected: result.rejected,
		});
	});

	it("refuses an entry that could never deploy, whatever the source kind", async () => {
		pinnedFetch.mockResolvedValue(
			jsonResponse([
				{
					...template,
					id: "socket",
					compose:
						"services:\n  app:\n    image: x\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n",
				},
			]),
		);
		const result = await syncTemplateSource(row);
		expect(result.templateCount).toBe(0);
		expect(result.rejected[0]).toMatch(/socket: compose safety — .*Docker socket/);
	});

	it("indexes an entry that publishes host ports, and flags it", async () => {
		// A catalogue entry is not a running stack: the stack-level opt-in is
		// what publishing needs, so the entry is kept and marked.
		pinnedFetch.mockResolvedValue(
			jsonResponse([
				{
					...template,
					id: "ported",
					compose: 'services:\n  app:\n    image: x\n    ports:\n      - "8080:80"\n',
				},
			]),
		);
		const result = await syncTemplateSource(row);
		expect(result.rejected).toEqual([]);
		expect(result.templateCount).toBe(1);
		const cached = JSON.parse(await readFile(getTemplateSourceCachePath("src-1"), "utf8"));
		expect(cached.templates[0].publishPorts).toBe(true);
	});

	it("reports an unreachable image as a warning, not a rejection", async () => {
		// A private-registry template is perfectly valid; we just cannot
		// confirm its tag anonymously.
		checkCatalogImages.mockResolvedValue([
			{ image: "traefik/whoami:v1.10", ok: false, error: "manifest not found" },
		]);
		pinnedFetch.mockResolvedValue(jsonResponse([template]));
		const result = await syncTemplateSource(row);
		expect(result.templateCount).toBe(1);
		expect(result.imageWarnings).toEqual(["traefik/whoami:v1.10: manifest not found"]);
	});

	it("skips the probe when asked", async () => {
		pinnedFetch.mockResolvedValue(jsonResponse([template]));
		await syncTemplateSource(row, { probeImages: false });
		expect(checkCatalogImages).not.toHaveBeenCalled();
	});

	it("records lastError and rethrows when the document cannot be read", async () => {
		pinnedFetch.mockResolvedValue(jsonResponse({ nope: true }, 500));
		await expect(syncTemplateSource(row)).rejects.toThrow(/HTTP 500/);
		expect(updates.at(-1)?.lastError).toMatch(/HTTP 500/);
	});

	it("says so when the body is not JSON", async () => {
		pinnedFetch.mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "",
			body: "<html>not json</html>",
			headers: { get: () => null },
			text: () => "<html>not json</html>",
			json: () => {
				throw new SyntaxError("Unexpected token <");
			},
		});
		await expect(syncTemplateSource(row)).rejects.toThrow(/did not return valid JSON/);
	});

	it("rejects an index that is not an array of templates", async () => {
		pinnedFetch.mockResolvedValue(jsonResponse({ items: [template] }));
		await expect(syncTemplateSource(row)).rejects.toThrow(/JSON array of templates/);
	});

	it("does not follow redirects", async () => {
		pinnedFetch.mockResolvedValue(jsonResponse({}, 302));
		await expect(syncTemplateSource(row)).rejects.toThrow(/redirects are not followed/);
	});
});

describe("namespacing", () => {
	it("round-trips a remote id", () => {
		const id = remoteTemplateId("src-1", "hello");
		expect(id).toBe("src-1/hello");
		expect(parseRemoteTemplateId(id)).toEqual({ templateSourceId: "src-1", localId: "hello" });
	});

	it("treats a built-in id as built-in", () => {
		// Catalog ids are kebab-case with no separator, so they never collide.
		expect(parseRemoteTemplateId("uptime-kuma")).toBeNull();
		expect(parseRemoteTemplateId("/leading")).toBeNull();
	});
});

describe("listSourcedTemplates", () => {
	it("returns nothing for an org whose sources have never synced", async () => {
		// The db mock answers with no rows; the read path must never fetch.
		expect(await listSourcedTemplates("org-1")).toEqual([]);
		expect(pinnedFetch).not.toHaveBeenCalled();
	});
});
