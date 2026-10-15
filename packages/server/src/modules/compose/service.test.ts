import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `hostPrivileged` demotion: the flag relaxes the compose safety check on
 * every deploy, so a source / compose-file change by anyone but the instance
 * admin must clear it (audit 2026-09 §2.5). Pure DB-boundary test — every
 * Docker/Traefik/scheduler import of service.ts is stubbed.
 */

const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
	set: vi.fn(),
	returning: vi.fn(),
	environmentFindFirst: vi.fn(),
	insert: vi.fn(),
	run: vi.fn(),
	writeComposeFile: vi.fn(),
	cloneComposeSource: vi.fn(),
}));

vi.mock("../../db", () => ({
	db: {
		query: {
			compose: { findFirst: mocks.findFirst },
			environments: { findFirst: mocks.environmentFindFirst },
		},
		insert: () => ({
			values: (values: unknown) => {
				mocks.insert(values);
				return { returning: mocks.returning };
			},
		}),
		update: () => ({
			set: (values: unknown) => {
				mocks.set(values);
				return { where: () => ({ returning: mocks.returning }) };
			},
		}),
	},
}));
vi.mock("./source", () => ({
	runComposeCommand: mocks.run,
	writeComposeFile: mocks.writeComposeFile,
	cloneComposeSource: mocks.cloneComposeSource,
}));
vi.mock("./containers", () => ({
	listComposeContainers: vi.fn(async () => []),
	invalidateComposeContainers: vi.fn(),
}));
vi.mock("./adapters", () => ({ getTraefik: vi.fn() }));
vi.mock("../backups/scheduler", () => ({ unregisterBackupsForService: vi.fn() }));
vi.mock("../schedules", () => ({ unregisterSchedulesForService: vi.fn() }));
vi.mock("../deployment/maintenance", () => ({ removeServiceLogs: vi.fn() }));
vi.mock("../cluster/swarm-node", () => ({ getServerSwarmNodeId: vi.fn() }));
vi.mock("../services/app-name", () => ({
	isAppNameTaken: vi.fn(async () => false),
	generateAppName: vi.fn(async (name: string) => `${name}-abc123`),
	randomAppNameSuffix: () => "abc123",
}));

import { ComposeValidationError } from "./compose-file";
import {
	COMPOSE_SOURCE_FIELDS,
	type ComposeRow,
	composeSourceChanged,
	createCompose,
	prepareComposeFiles,
	saveComposeFile,
	stopCompose,
	updateComposeById,
} from "./service";

const privilegedRow = {
	composeId: "cmp-1",
	name: "portainer",
	appName: "portainer-abc123",
	description: null,
	env: null,
	status: "idle",
	composeType: "docker-compose",
	composeFile: "services:\n  x:\n    image: alpine\n",
	sourceType: "raw",
	repository: null,
	owner: null,
	branch: null,
	composePath: "./docker-compose.yml",
	autoDeploy: true,
	watchPaths: null,
	buildEnabled: false,
	publishPorts: false,
	buildArgs: null,
	isPreviewDeploymentsActive: false,
	previewForksRequireApproval: true,
	previewEnv: null,
	previewLimit: 3,
	previewTtlHours: null,
	previewDatabaseKind: null,
	previewDatabaseId: null,
	previewSeedCommand: null,
	gitUrl: null,
	gitBranch: null,
	customGitSSHKeyId: null,
	githubId: null,
	gitlabId: null,
	bitbucketId: null,
	giteaId: null,
	preDeployCommand: null,
	postDeployCommand: null,
	isolatedDeployment: false,
	suffix: "",
	hostPrivileged: true,
	environmentId: "env-1",
	serverId: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
} satisfies ComposeRow;

const DOCKER_SOCK_COMPOSE = `services:
  agent:
    image: portainer/agent
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
`;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findFirst.mockResolvedValue(privilegedRow);
	mocks.returning.mockResolvedValue([privilegedRow]);
	mocks.environmentFindFirst.mockResolvedValue({ environmentId: "env-1" });
	mocks.run.mockResolvedValue("");
});

describe("prepareComposeFiles legacy Stack refusal", () => {
	it("queries the primary and refuses before any source/rendered writes or clone", async () => {
		mocks.run.mockResolvedValueOnce("a".repeat(25)).mockResolvedValueOnce(
			JSON.stringify([
				{
					Spec: {
						Name: "portainer-abc123_db",
						Labels: { "com.docker.stack.namespace": "portainer-abc123" },
						TaskTemplate: { ContainerSpec: {} },
					},
				},
			]),
		);
		await expect(
			prepareComposeFiles({ ...privilegedRow, composeType: "stack", serverId: "remote-1" }),
		).rejects.toThrow(/legacy service names/);
		expect(mocks.run).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ serverId: "remote-1" }),
			expect.stringContaining("docker service ls"),
			{ onPrimary: true },
		);
		expect(mocks.writeComposeFile).not.toHaveBeenCalled();
		expect(mocks.cloneComposeSource).not.toHaveBeenCalled();
		expect(mocks.findFirst).not.toHaveBeenCalled();
	});
});

describe("stopCompose across naming upgrades", () => {
	it("stops legacy containers by exact project ownership without re-rendering source or volumes", async () => {
		mocks.run.mockResolvedValueOnce("abcdef123456\n").mockResolvedValueOnce("");
		await stopCompose(privilegedRow);
		expect(mocks.run.mock.calls.map((call) => call[1])).toEqual([
			"docker ps -q --filter label=com.docker.compose.project='portainer-abc123'",
			"docker stop 'abcdef123456'",
		]);
	});

	it("refuses unexpected container identifiers before any stop command", async () => {
		mocks.run.mockResolvedValueOnce("invalid-output");
		await expect(stopCompose(privilegedRow)).rejects.toThrow(/Could not verify Compose containers/);
		expect(mocks.run).toHaveBeenCalledTimes(1);
	});
});

describe("createCompose with an initial file", () => {
	const input = {
		name: "stack",
		environmentId: "env-1",
		composeType: "docker-compose",
		sourceType: "raw",
	} as const;

	it.each([
		"services: {}",
		"services:\n  web: [not-a-service]",
		"services:\n  web:\n    image: nginx\n    ports: ['8080:80']",
		"services:\n  web:\n    build: .",
		DOCKER_SOCK_COMPOSE,
	])("refuses invalid or unsafe input before inserting a row: %s", async (composeFile) => {
		await expect(createCompose({ ...input, composeFile })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.environmentFindFirst).not.toHaveBeenCalled();
	});

	it("saves the validated source with the row in one insert and leaves runtime untouched", async () => {
		const composeFile = "services:\n  web:\n    image: nginx:alpine\n";
		await createCompose({ ...input, composeFile });
		expect(mocks.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				composeFile,
				sourceType: "raw",
				hostPrivileged: false,
				publishPorts: false,
			}),
		);
		expect(mocks.set).not.toHaveBeenCalled();
	});

	it("keeps the existing empty draft path and refuses a file for a git source", async () => {
		await createCompose(input);
		expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ composeFile: "" }));
		mocks.insert.mockClear();
		await expect(
			createCompose({
				...input,
				sourceType: "git",
				composeFile: "services:\n  web:\n    image: nginx\n",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(mocks.insert).not.toHaveBeenCalled();
	});
});

describe("composeSourceChanged", () => {
	it("covers every column that decides what the next deploy renders", () => {
		expect([...COMPOSE_SOURCE_FIELDS].sort()).toEqual(
			[
				"sourceType",
				"repository",
				"owner",
				"branch",
				"composePath",
				"gitUrl",
				"gitBranch",
				"customGitSSHKeyId",
				"githubId",
				"gitlabId",
				"bitbucketId",
				"giteaId",
			].sort(),
		);
	});

	it("ignores undefined and unchanged values", () => {
		expect(composeSourceChanged(privilegedRow, {})).toBe(false);
		expect(composeSourceChanged(privilegedRow, { gitUrl: undefined, repository: null })).toBe(
			false,
		);
		expect(composeSourceChanged(privilegedRow, { name: "renamed", autoDeploy: false })).toBe(false);
	});

	it("detects a re-pointed source", () => {
		expect(composeSourceChanged(privilegedRow, { gitUrl: "https://evil.example/x.git" })).toBe(
			true,
		);
		expect(composeSourceChanged(privilegedRow, { sourceType: "github" })).toBe(true);
		expect(composeSourceChanged(privilegedRow, { composePath: "./other.yml" })).toBe(true);
	});
});

describe("updateComposeById — hostPrivileged demotion", () => {
	it("clears hostPrivileged when a non-admin changes the source", async () => {
		await updateComposeById("cmp-1", { sourceType: "git", gitUrl: "https://evil.example/x.git" });
		expect(mocks.set).toHaveBeenCalledTimes(1);
		expect(mocks.set.mock.calls[0]?.[0]).toMatchObject({
			sourceType: "git",
			gitUrl: "https://evil.example/x.git",
			hostPrivileged: false,
		});
	});

	it("keeps hostPrivileged when the instance admin changes the source", async () => {
		await updateComposeById(
			"cmp-1",
			{ gitUrl: "https://github.com/acme/portainer.git" },
			{ callerIsInstanceAdmin: true },
		);
		expect(mocks.set.mock.calls[0]?.[0]).not.toHaveProperty("hostPrivileged");
	});

	it("keeps hostPrivileged for non-source edits by a non-admin", async () => {
		await updateComposeById("cmp-1", { name: "renamed", autoDeploy: false });
		expect(mocks.set.mock.calls[0]?.[0]).not.toHaveProperty("hostPrivileged");
	});

	it("never re-enables the flag on an unprivileged row", async () => {
		mocks.findFirst.mockResolvedValue({ ...privilegedRow, hostPrivileged: false });
		await updateComposeById("cmp-1", { gitUrl: "https://github.com/acme/x.git" });
		expect(mocks.set.mock.calls[0]?.[0]).not.toHaveProperty("hostPrivileged");
	});
});

describe("saveComposeFile — hostPrivileged demotion", () => {
	it("rejects docker.sock for a non-admin caller and demotes the row on a safe file", async () => {
		await expect(saveComposeFile(privilegedRow, DOCKER_SOCK_COMPOSE)).rejects.toBeInstanceOf(
			ComposeValidationError,
		);
		expect(mocks.set).not.toHaveBeenCalled();

		const safe = "services:\n  web:\n    image: nginx\n";
		await saveComposeFile(privilegedRow, safe);
		expect(mocks.set).toHaveBeenCalledWith({ composeFile: safe, hostPrivileged: false });
	});

	it("keeps the relaxed check and the flag for the instance admin", async () => {
		await saveComposeFile(privilegedRow, DOCKER_SOCK_COMPOSE, { callerIsInstanceAdmin: true });
		expect(mocks.set).toHaveBeenCalledWith({ composeFile: DOCKER_SOCK_COMPOSE });
	});

	it("does not touch the flag on rows that never had it", async () => {
		const plain = { ...privilegedRow, hostPrivileged: false };
		const safe = "services:\n  web:\n    image: nginx\n";
		await saveComposeFile(plain, safe, { callerIsInstanceAdmin: true });
		expect(mocks.set).toHaveBeenCalledWith({ composeFile: safe });
	});
});
