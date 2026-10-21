#!/usr/bin/env node
/**
 * Disposable split-worker upgrade proof. Run `before` on the release, then
 * `after` on the candidate with the SAME private state file and bootstrap key.
 * Requires UPGRADE_PROOF_DISPOSABLE=1, a loopback NIXPLOY_URL and the canonical
 * installer services. Never run against an operator's installation.
 * UPGRADE_PROOF_TARGET_IMAGE must name the already-loaded candidate in a
 * loopback registry. Before upgrading, both candidate roles must reject the
 * populated legacy database through their actual default entrypoint.
 *
 * UPGRADE_PROOF_FILE defaults to $RUNNER_TEMP/organization-upgrade-proof.private.json.
 * The file contains synthetic variables and original metadata: do not upload it.
 * `--self-test` checks pure helpers without HTTP, Docker or database access.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE_NAMES = ["nixploy", "nixploy-worker", "nixploy-postgres"];
const MARKER = "organizationUpgradeProof";
const IMAGE = "traefik/whoami:v1.10.1";
const BOOT_PROBE_LABEL = "io.nixploy.organization-upgrade-boot-proof";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const ensure = (condition, message) => {
	if (!condition) throw new Error(message);
};
const canonical = (value) =>
	Array.isArray(value)
		? value.map(canonical)
		: value && typeof value === "object"
			? Object.fromEntries(
					Object.keys(value)
						.sort()
						.map((key) => [key, canonical(value[key])]),
				)
			: value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const digest = (value) =>
	createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const parse = (text, label) => {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${label} returned invalid JSON`);
	}
};

export function targetImageReference(value) {
	ensure(
		typeof value === "string" && value.length > 0 && value.length <= 512 && !/\s/.test(value),
		"UPGRADE_PROOF_TARGET_IMAGE is required",
	);
	const match =
		/^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/([a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*)(?::([A-Za-z0-9_][A-Za-z0-9_.-]{0,127}))?(?:@(sha256:[a-f0-9]{64}))?$/.exec(
			value,
		);
	ensure(
		match &&
			(!match[2] || (Number(match[2]) > 0 && Number(match[2]) <= 65535)) &&
			(match[4] || match[5]),
		"Candidate image must be a tagged or digest-pinned loopback registry reference",
	);
	return value;
}

export function configuration(env) {
	ensure(env.UPGRADE_PROOF_DISPOSABLE === "1", "UPGRADE_PROOF_DISPOSABLE=1 is required");
	ensure(env.NIXPLOY_URL && env.NIXPLOY_API_KEY, "NIXPLOY_URL and NIXPLOY_API_KEY are required");
	const url = new URL(env.NIXPLOY_URL);
	ensure(
		["http:", "https:"].includes(url.protocol) &&
			["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
			!url.username &&
			!url.password &&
			url.pathname === "/" &&
			!url.search &&
			!url.hash,
		"Upgrade proof requires a loopback HTTP(S) origin",
	);
	const stateFile =
		env.UPGRADE_PROOF_FILE ??
		(env.RUNNER_TEMP && join(env.RUNNER_TEMP, "organization-upgrade-proof.private.json"));
	ensure(
		stateFile && isAbsolute(stateFile),
		"An absolute UPGRADE_PROOF_FILE or RUNNER_TEMP is required",
	);
	const timeout = Number(env.UPGRADE_PROOF_TIMEOUT_MS ?? 300_000);
	ensure(
		timeout >= 1000 && timeout <= 900_000,
		"Upgrade proof timeout is outside its allowed range",
	);
	ensure(
		!env.DOCKER_HOST || env.DOCKER_HOST.startsWith("unix://"),
		"A local Docker socket is required",
	);
	return {
		origin: url.origin,
		apiKey: env.NIXPLOY_API_KEY,
		stateFile,
		timeout,
		targetImage: targetImageReference(env.UPGRADE_PROOF_TARGET_IMAGE),
	};
}

export function canaries(nonce) {
	const prefix = `UPGRADE_PROOF_${nonce.toUpperCase()}_`;
	const values = {
		[`${prefix}QUOTE`]: `upgrade-env-${nonce}: "double" and 'single'`,
		[`${prefix}MULTILINE`]: "first line\nsecond line\tthird",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: These characters must reach the task unchanged.
		[`${prefix}DOLLAR`]: "literal$PATH ${NOT_EXPANDED} $$",
		[`${prefix}BACKTICK`]: "`literal-looking-text`",
		[`${prefix}EMPTY`]: "",
	};
	return {
		values,
		env: Object.entries(values)
			.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
			.join("\n"),
	};
}

function docker(args, { input, allowFailure = false, timeoutMs = 30_000, env } = {}) {
	const result = spawnSync("docker", args, {
		input,
		env,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
		timeout: timeoutMs,
	});
	if (!allowFailure) ensure(result.status === 0, "Docker verification command failed");
	return result;
}

function inspectService(name) {
	const rows = parse(docker(["service", "inspect", name]).stdout, "Service inspection");
	ensure(rows.length === 1 && rows[0].Spec.Name === name, "Service identity is ambiguous");
	return rows[0];
}

function platform() {
	const endpoint = parse(
		docker(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"]).stdout,
		"Docker context",
	);
	ensure(
		typeof endpoint === "string" && endpoint.startsWith("unix://"),
		"Docker context must be local",
	);
	const services = SERVICE_NAMES.map(inspectService);
	for (const service of services) {
		ensure(/^[a-z0-9]{25}$/.test(service.ID), "Canonical service identity is invalid");
		ensure(
			service.Spec.Mode.Replicated?.Replicas === 1,
			"Canonical services must each have one replica",
		);
	}
	const envOf = (service) =>
		Object.fromEntries(
			(service.Spec.TaskTemplate.ContainerSpec.Env ?? []).map((entry) => {
				const split = entry.indexOf("=");
				return [entry.slice(0, split), entry.slice(split + 1)];
			}),
		);
	ensure(envOf(services[0]).NIXPLOY_ROLE === "panel", "Canonical panel must have the panel role");
	ensure(
		envOf(services[1]).NIXPLOY_ROLE === "worker",
		"Canonical worker must have the worker role",
	);
	ensure(
		services[0].Spec.TaskTemplate.ContainerSpec.Image ===
			services[1].Spec.TaskTemplate.ContainerSpec.Image,
		"Panel and worker must run the same image",
	);
	const pg = services[2];
	ensure(
		pg.Spec.TaskTemplate.ContainerSpec.Mounts?.some(
			(mount) => mount.Type === "volume" && mount.Source === "nixploy-postgres-data",
		),
		"Canonical PostgreSQL volume is missing",
	);
	const ids = docker([
		"ps",
		"-q",
		"--no-trunc",
		"--filter",
		`label=com.docker.swarm.service.id=${pg.ID}`,
	])
		.stdout.trim()
		.split("\n")
		.filter(Boolean);
	ensure(
		ids.length === 1 && /^[a-f0-9]{64}$/.test(ids[0]),
		"One local canonical PostgreSQL task is required",
	);
	const [container] = parse(docker(["inspect", ids[0]]).stdout, "PostgreSQL task inspection");
	ensure(
		container.State.Running && container.Config.Labels["com.docker.swarm.service.id"] === pg.ID,
		"PostgreSQL task ownership changed",
	);
	const env = envOf(pg);
	ensure(
		/^[a-zA-Z0-9_.-]+$/.test(env.POSTGRES_USER ?? "") &&
			/^[a-zA-Z0-9_.-]+$/.test(env.POSTGRES_DB ?? ""),
		"Canonical PostgreSQL database/user configuration is unavailable",
	);
	const database = new URL(envOf(services[0]).DATABASE_URL);
	ensure(
		database.hostname === "nixploy-postgres" &&
			decodeURIComponent(database.username) === env.POSTGRES_USER &&
			decodeURIComponent(database.pathname.slice(1)) === env.POSTGRES_DB,
		"Panel database does not match canonical PostgreSQL",
	);
	const [volume] = parse(
		docker(["volume", "inspect", "nixploy-postgres-data"]).stdout,
		"Platform volume inspection",
	);
	return {
		services: services.map((service) => ({ id: service.ID, name: service.Spec.Name })),
		postgres: {
			id: container.Id,
			createdAt: container.Created,
			user: env.POSTGRES_USER,
			database: env.POSTGRES_DB,
		},
		volume: { name: volume.Name, createdAt: volume.CreatedAt },
	};
}

function sql(platformState, statement, { expectedError } = {}) {
	const result = docker(
		[
			"exec",
			"-i",
			platformState.postgres.id,
			"psql",
			"-X",
			"-qAt",
			"-v",
			"ON_ERROR_STOP=1",
			"-U",
			platformState.postgres.user,
			"-d",
			platformState.postgres.database,
		],
		{ input: `SET standard_conforming_strings=on;\n${statement}\n`, allowFailure: true },
	);
	if (expectedError) {
		ensure(
			result.status !== 0 && expectedError.test(result.stderr ?? ""),
			"Expected upgrade fence was not enforced",
		);
		return;
	}
	ensure(result.status === 0, "Platform PostgreSQL verification failed");
	return result.stdout.trim();
}

async function request(config, method, procedure, input) {
	const url = new URL(`/api/${procedure}`, config.origin);
	if (method === "GET" && input !== undefined) url.searchParams.set("input", JSON.stringify(input));
	const response = await fetch(url, {
		method,
		redirect: "error",
		headers: { "x-api-key": config.apiKey, "content-type": "application/json" },
		...(method === "POST" ? { body: JSON.stringify(input) } : {}),
		signal: AbortSignal.timeout(20_000),
	});
	ensure(
		response.ok,
		`${procedure} unavailable (HTTP ${response.status}); upgrade proof remains pending`,
	);
	const body = parse(await response.text(), procedure);
	return body?.result?.data ?? body;
}

async function save(config, state, initial = false) {
	await mkdir(dirname(config.stateFile), { recursive: true, mode: 0o700 });
	const target = initial
		? config.stateFile
		: `${config.stateFile}.${randomBytes(8).toString("hex")}.tmp`;
	const file = await open(target, "wx", 0o600);
	try {
		await file.writeFile(JSON.stringify(state, null, 2));
		await file.sync();
	} finally {
		await file.close();
	}
	if (!initial) {
		try {
			await rename(target, config.stateFile);
		} catch (error) {
			await unlink(target);
			throw error;
		}
	}
}

async function load(config) {
	const file = await open(config.stateFile, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await file.stat();
		ensure(
			stat.isFile() && (stat.mode & 0o077) === 0,
			"Upgrade state must be a private regular file (0600)",
		);
		ensure(
			!process.getuid || stat.uid === process.getuid(),
			"Upgrade state owner differs from this process",
		);
		return parse(await file.readFile("utf8"), "Private upgrade state");
	} finally {
		await file.close();
	}
}

function identities(platformState) {
	return parse(
		sql(
			platformState,
			`SELECT json_build_object(
		'users',(SELECT coalesce(json_agg(id ORDER BY id),'[]') FROM "user"),
		'sessions',(SELECT coalesce(json_agg(id ORDER BY id),'[]') FROM "session"),
		'apiKeys',(SELECT coalesce(json_agg(id ORDER BY id),'[]') FROM "apikey"));`,
		),
		"Identity inventory",
	);
}

function existingServices() {
	const ids = docker(["service", "ls", "--quiet"]).stdout.trim().split("\n").filter(Boolean);
	return ids.map((id) => {
		const [service] = parse(
			docker(["service", "inspect", id]).stdout,
			"Existing service inventory",
		);
		return { id: service.ID, name: service.Spec.Name, spec: digest(service.Spec) };
	});
}

function preserveSources(state) {
	for (const original of state.existingServices) {
		const current = inspectService(original.name);
		ensure(current.ID === original.id, "An original Docker service was replaced or removed");
		if (!["nixploy", "nixploy-worker"].includes(original.name)) {
			ensure(
				digest(current.Spec) === original.spec,
				"An original non-panel service specification changed",
			);
		}
	}
	ensure(
		equal(identities(state.platform), state.identities),
		"Original user/session/API-key identities changed",
	);
}

function candidateImage(config) {
	const rows = parse(
		docker(["image", "inspect", config.targetImage]).stdout,
		"Already-loaded candidate image",
	);
	ensure(
		rows.length === 1 && /^sha256:[a-f0-9]{64}$/.test(rows[0].Id),
		"An already-loaded candidate image is required",
	);
	ensure(
		rows[0].Config.Entrypoint?.length && rows[0].Config.Cmd?.length,
		"Candidate default entrypoint and command are required",
	);
	return rows[0];
}

function requireCandidateImage(actual, expected) {
	ensure(
		/^sha256:[a-f0-9]{64}$/.test(expected) && actual === expected,
		"Running candidate image differs from the immutable boot-probed image",
	);
}

function runningCandidateRoles(expectedImageId) {
	return ["nixploy", "nixploy-worker"].map((name) => {
		const service = inspectService(name);
		const [image] = parse(
			docker(["image", "inspect", service.Spec.TaskTemplate.ContainerSpec.Image]).stdout,
			"Running role image",
		);
		requireCandidateImage(image.Id, expectedImageId);
		const desired = docker([
			"service",
			"ps",
			"--no-trunc",
			"--filter",
			"desired-state=running",
			"--format",
			"{{.ID}}",
			service.ID,
		])
			.stdout.trim()
			.split("\n")
			.filter(Boolean);
		const ids = docker([
			"ps",
			"-q",
			"--no-trunc",
			"--filter",
			`label=com.docker.swarm.service.id=${service.ID}`,
		])
			.stdout.trim()
			.split("\n")
			.filter(Boolean);
		ensure(
			ids.every((id) => /^[a-f0-9]{64}$/.test(id)),
			"Running role container identity is invalid",
		);
		const tasks = ids.length
			? parse(docker(["inspect", ...ids]).stdout, "Running role tasks").filter(
					(task) =>
						task.Config.Labels["com.docker.swarm.service.id"] === service.ID &&
						desired.includes(task.Config.Labels["com.docker.swarm.task.id"]),
				)
			: [];
		ensure(
			desired.length === 1 && tasks.length === 1 && tasks[0].State.Running,
			"One current candidate task per canonical role is required",
		);
		requireCandidateImage(tasks[0].Image, expectedImageId);
		return {
			serviceId: service.ID,
			name,
			imageId: tasks[0].Image,
			containerId: tasks[0].Id,
			createdAt: tasks[0].Created,
		};
	});
}

function legacyDatabaseSnapshot(state) {
	const schema = docker([
		"exec",
		state.platform.postgres.id,
		"pg_dump",
		"--schema-only",
		"--no-owner",
		"--no-privileges",
		"-U",
		state.platform.postgres.user,
		"-d",
		state.platform.postgres.database,
	]).stdout;
	// Recent pg_dump versions randomize their psql restrict key on each call.
	const stableSchema = schema.replace(/^\\(?:un)?restrict\s+.*(?:\r?\n|$)/gm, "");
	return {
		schema: digest(stableSchema),
		journal: parse(
			sql(
				state.platform,
				`SELECT coalesce(json_agg(row_to_json(m) ORDER BY id), '[]') FROM drizzle.__drizzle_migrations m;`,
			),
			"Legacy migration journal",
		),
		organization: parse(
			sql(
				state.platform,
				`SELECT coalesce(json_agg(row_to_json(o)), '[]') FROM
				(SELECT id,metadata FROM organization WHERE id=${literal(state.organizationId)}) o;`,
			),
			"Legacy organization snapshot",
		),
	};
}

function oldRoleSnapshot() {
	return SERVICE_NAMES.map((name) => {
		const service = inspectService(name);
		const ids = docker(["service", "ps", "--no-trunc", "--quiet", service.ID])
			.stdout.trim()
			.split("\n")
			.filter(Boolean);
		const tasks = ids.length
			? parse(docker(["inspect", "--type", "task", ...ids]).stdout, "Old platform tasks")
			: [];
		ensure(tasks.length === ids.length, "Every old platform task must be inspectable");
		return {
			id: service.ID,
			createdAt: service.CreatedAt,
			image: service.Spec.TaskTemplate.ContainerSpec.Image,
			spec: digest(service.Spec),
			tasks: tasks
				.map((task) => ({
					id: task.ID,
					serviceId: task.ServiceID,
					nodeId: task.NodeID,
					desired: task.DesiredState,
					actual: task.Status?.State,
					containerId: task.Status?.ContainerStatus?.ContainerID,
				}))
				.sort((a, b) => a.id.localeCompare(b.id)),
		};
	});
}

export function runtimeEnvironment(entries = []) {
	const values = Object.create(null);
	for (const entry of entries) {
		ensure(typeof entry === "string", "Canonical runtime environment is invalid");
		const split = entry.indexOf("=");
		const name = entry.slice(0, split),
			value = entry.slice(split + 1);
		ensure(
			split > 0 &&
				/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(name) &&
				!entry.includes("\0") &&
				(!Object.hasOwn(values, name) || values[name] === value),
			"Canonical runtime environment contains conflicting duplicates or invalid entries",
		);
		values[name] = value;
	}
	return values;
}

function requiredBootEnvironment() {
	const panel = runtimeEnvironment(inspectService("nixploy").Spec.TaskTemplate.ContainerSpec.Env);
	const worker = runtimeEnvironment(
		inspectService("nixploy-worker").Spec.TaskTemplate.ContainerSpec.Env,
	);
	const keys = [
		"DATABASE_URL",
		"ENCRYPTION_KEYS",
		"ENCRYPTION_KEY",
		"BETTER_AUTH_SECRET",
		"BETTER_AUTH_URL",
	];
	for (const key of keys)
		ensure(panel[key] === worker[key], "Canonical role database/key/auth environments differ");
	ensure(
		worker.DATABASE_URL &&
			worker.BETTER_AUTH_SECRET &&
			worker.BETTER_AUTH_URL &&
			(worker.ENCRYPTION_KEYS || worker.ENCRYPTION_KEY),
		"Canonical worker database/key/auth environment is incomplete",
	);
	return Object.fromEntries(
		keys.filter((key) => Object.hasOwn(worker, key)).map((key) => [key, worker[key]]),
	);
}

function ownedBootContainer(container, record, image) {
	ensure(
		/^[a-f0-9]{64}$/.test(container.Id) &&
			(!record.id || container.Id === record.id) &&
			container.Name === `/${record.name}` &&
			container.Image === record.imageId &&
			container.Config.Labels?.[BOOT_PROBE_LABEL] === record.label &&
			container.HostConfig.AutoRemove === true &&
			container.HostConfig.NetworkMode === "nixploy-internal" &&
			!container.HostConfig.Privileged &&
			Object.keys(container.HostConfig.PortBindings ?? {}).length === 0 &&
			!container.Mounts?.some((mount) => mount.Type === "bind") &&
			equal(container.Config.Entrypoint, image.Config.Entrypoint) &&
			equal(container.Config.Cmd, image.Config.Cmd) &&
			!container.Config.Env.some((entry) => entry.startsWith("NIXPLOY_UPGRADE_DRAINED=")),
		"Candidate boot container identity changed; cleanup refused",
	);
}

async function findUncertainBootContainer(record, image, inspect = docker, pause = sleep) {
	for (let attempt = 0; attempt < 10; attempt++) {
		const found = inspect(["inspect", record.name], { allowFailure: true, timeoutMs: 3000 });
		if (found.status === 0) {
			const [container] = parse(found.stdout, "Uncertain candidate create ownership");
			ownedBootContainer(container, record, image);
			return container;
		}
		ensure(
			/no such object|no such container/i.test(found.stderr),
			"Uncertain candidate create lookup failed",
		);
		if (attempt < 9) await pause(250);
	}
	throw new Error(
		"Candidate create outcome remains uncertain; exact owned container was not found",
	);
}

async function rejectedCandidateBoot(config, state, image, required, role) {
	const record = {
		role,
		name: `upgrade-reject-${state.nonce}-${role}`,
		label: `${state.nonce}:${role}`,
		imageId: image.Id,
		log: `${config.stateFile}.candidate-${role}.private.log`,
	};
	const log = await open(record.log, "wx", 0o600);
	let id,
		createAttempted = false;
	try {
		state.candidateBoots ??= [];
		state.candidateBoots.push(record);
		await save(config, state);
		const env = { ...process.env, ...required, NIXPLOY_ROLE: role, NIXPLOY_DB_WAIT_SECONDS: "5" };
		delete env.NIXPLOY_UPGRADE_DRAINED;
		const keys = [...Object.keys(required), "NIXPLOY_ROLE", "NIXPLOY_DB_WAIT_SECONDS"];
		createAttempted = true;
		const created = docker(
			[
				"create",
				"--rm",
				"--name",
				record.name,
				"--label",
				`${BOOT_PROBE_LABEL}=${record.label}`,
				"--network",
				"nixploy-internal",
				...keys.flatMap((key) => ["--env", key]),
				image.Id,
			],
			{ env, allowFailure: true },
		);
		ensure(
			!created.error &&
				created.signal === null &&
				created.status === 0 &&
				/^[a-f0-9]{64}$/.test(created.stdout.trim()),
			"Candidate create response is uncertain; it will not be started",
		);
		id = created.stdout.trim();
		record.id = id;
		await save(config, state);
		const [container] = parse(docker(["inspect", id]).stdout, "Candidate boot ownership");
		ownedBootContainer(container, record, image);
		record.createdAt = container.Created;
		await save(config, state); // Record full ownership before the container can execute.
		const result = docker(["start", "--attach", id], {
			allowFailure: true,
			timeoutMs: 60_000,
			env,
		});
		await log.writeFile(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
		await log.sync();
		ensure(
			!result.error &&
				result.signal === null &&
				typeof result.status === "number" &&
				result.status !== 0,
			"Candidate boot must fail itself within 60 seconds; timeout or successful startup is not proof",
		);
		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
		ensure(
			role === "all"
				? /current host update\.sh/.test(output) && /drains all old roles/.test(output)
				: /column[^\n]*metadata_v2[^\n]*does not exist/i.test(output),
			"Candidate did not reject legacy startup through the expected boundary failure",
		);
		ensure(
			!/Nixploy ready on/.test(output),
			"Candidate listened before rejecting the legacy database",
		);
		record.expectedRejection = true;
	} finally {
		try {
			await log.close();
		} finally {
			if (!id && createAttempted) {
				record.cleanupUncertain = true;
				await save(config, state);
				const container = await findUncertainBootContainer(record, image);
				id = container.Id;
				record.id = id;
				record.createdAt = container.Created;
				record.cleanupUncertain = false;
				await save(config, state); // Adopt full verified identity before removal.
			}
			if (id) {
				const inspected = docker(["inspect", id], { allowFailure: true });
				if (inspected.status === 0) {
					const [container] = parse(inspected.stdout, "Candidate cleanup ownership");
					ownedBootContainer(container, record, image);
					const removed = docker(["rm", "--force", "--volumes", id], { allowFailure: true });
					if (removed.status !== 0)
						ensure(
							/no such container/i.test(removed.stderr),
							"Owned candidate container cleanup failed",
						);
				} else
					ensure(
						/no such object|no such container/i.test(inspected.stderr),
						"Candidate cleanup identity is uncertain",
					);
				const remaining = docker(["inspect", id], { allowFailure: true });
				ensure(
					remaining.status !== 0 && /no such object|no such container/i.test(remaining.stderr),
					"Owned candidate boot container remains or cannot be verified",
				);
				record.cleaned = true;
				await save(config, state);
			}
		}
	}
}

async function verifyCandidateBootRejections(config, state, image) {
	const [network] = parse(
		docker(["network", "inspect", "nixploy-internal"]).stdout,
		"Canonical private overlay",
	);
	ensure(
		network.Name === "nixploy-internal" &&
			network.Driver === "overlay" &&
			network.Attachable === true,
		"Candidate boot probes require the canonical attachable private overlay",
	);
	const required = requiredBootEnvironment();
	const database = legacyDatabaseSnapshot(state);
	const roles = oldRoleSnapshot();
	state.candidateRejectionBaseline = { database, roles };
	await save(config, state);
	for (const role of ["all", "panel"]) {
		await rejectedCandidateBoot(config, state, image, required, role);
		ensure(
			equal(legacyDatabaseSnapshot(state), database),
			"Candidate boot changed legacy schema, migration journal or organization values",
		);
		ensure(
			equal(oldRoleSnapshot(), roles),
			"Candidate boot changed old canonical service images or actual tasks",
		);
		const loaded = await request(config, "GET", "organization.environment");
		ensure(
			loaded.organizationId === state.organizationId && loaded.env === state.expectedEnv,
			"Old API no longer returns the exact same organization canary after candidate rejection",
		);
		preserveSources(state);
	}
	state.candidateBootRejectionsVerified = true;
	await save(config, state);
}

async function before(config) {
	const current = platform();
	const image = candidateImage(config);
	const organization = await request(config, "GET", "organization.environment");
	ensure(
		typeof organization.organizationId === "string" && typeof organization.env === "string",
		"Old release lacks readable organization.environment; upgrade proof remains pending",
	);
	const rows = parse(
		sql(
			current,
			`SELECT coalesce(json_agg(row_to_json(o)), '[]') FROM
		(SELECT id,metadata FROM organization WHERE id=${literal(organization.organizationId)}) o;`,
		),
		"Legacy organization metadata",
	);
	ensure(rows.length === 1, "REST organization does not belong to canonical PostgreSQL");
	const original = rows[0].metadata ? parse(rows[0].metadata, "Legacy metadata") : {};
	ensure(
		original && typeof original === "object" && !Array.isArray(original),
		"Legacy metadata must be an object",
	);
	ensure(!Object.hasOwn(original, MARKER), "Upgrade proof marker already exists");
	ensure(
		!Object.hasOwn(original, "env") || original.env === organization.env,
		"Legacy REST/storage values differ",
	);
	const nonce = randomBytes(8).toString("hex"),
		generated = canaries(nonce);
	const unrelated = { ...original, [MARKER]: nonce };
	delete unrelated.env;
	const expectedEnv = `${organization.env}${organization.env && !organization.env.endsWith("\n") ? "\n" : ""}${generated.env}`;
	const state = {
		version: 1,
		status: "prepared",
		origin: config.origin,
		candidateTargetImage: config.targetImage,
		candidateImageId: image.Id,
		nonce,
		platform: current,
		organizationId: organization.organizationId,
		originalEnv: organization.env,
		originalUnrelated: Object.fromEntries(
			Object.entries(original).filter(([key]) => key !== "env"),
		),
		expectedUnrelated: unrelated,
		expectedEnv,
		expectedValues: generated.values,
		identities: identities(current),
		existingServices: existingServices(),
		createdAt: new Date().toISOString(),
	};
	await save(config, state, true);
	const seeded = { ...unrelated, env: expectedEnv };
	const result = sql(
		current,
		`UPDATE organization SET metadata=${literal(JSON.stringify(seeded))}
		WHERE id=${literal(state.organizationId)} AND metadata IS NOT DISTINCT FROM ${rows[0].metadata === null ? "NULL" : literal(rows[0].metadata)} RETURNING id;`,
	);
	ensure(result === state.organizationId, "Legacy metadata changed before seeding; no row updated");
	state.status = "seeded";
	await save(config, state);
	const loaded = await request(config, "GET", "organization.environment");
	ensure(loaded.env === expectedEnv, "Old API did not preserve seeded legacy variables");
	await verifyCandidateBootRejections(config, state, image);
	console.log(
		JSON.stringify({
			mode: "before",
			seeded: true,
			canaryVariables: Object.keys(generated.values).length,
			candidateAllBootRejectedBeforeDDL: true,
			candidatePanelBootRejectedBeforeListen: true,
			oldCanonicalRolesAndLegacyDatabasePreserved: true,
		}),
	);
}

async function cleanup(config, state) {
	if (state.project) {
		const project = await request(config, "GET", "project.one", {
			projectId: state.project.projectId,
		});
		ensure(
			project.projectId === state.project.projectId &&
				project.name === state.project.name &&
				project.organizationId === state.organizationId,
			"Proof project ownership changed; cleanup refused",
		);
		const found = docker(["service", "inspect", `upgrade-env-${state.nonce}`], {
			allowFailure: true,
		});
		if (found.status === 0) {
			const [service] = parse(found.stdout, "Proof service cleanup inspection");
			ensure(
				service.Spec.Name === `upgrade-env-${state.nonce}` &&
					(!state.serviceId || service.ID === state.serviceId) &&
					service.Spec.TaskTemplate.ContainerSpec.Labels?.["io.nixploy.deployment-revision"] ===
						state.deploymentId,
				"Proof service ownership changed; cleanup refused",
			);
			state.serviceId = service.ID;
		} else
			ensure(/no such service/i.test(found.stderr), "Proof service lookup failed; cleanup refused");
		await request(config, "POST", "project.delete", { projectId: state.project.projectId });
		const until = Date.now() + 30_000;
		while (Date.now() < until) {
			const exists = docker(
				["service", "inspect", state.application?.appName ?? `upgrade-env-${state.nonce}`],
				{ allowFailure: true },
			);
			if (exists.status !== 0 && /no such service/i.test(exists.stderr)) break;
			await sleep(500);
		}
		const remaining = docker(
			["service", "inspect", state.application?.appName ?? `upgrade-env-${state.nonce}`],
			{ allowFailure: true },
		);
		ensure(
			remaining.status !== 0 && /no such service/i.test(remaining.stderr),
			"Proof application service remains after project cleanup",
		);
		if (state.serviceId) {
			let tasks = "";
			for (const deadline = Date.now() + 30_000; Date.now() < deadline; ) {
				tasks = docker([
					"ps",
					"-aq",
					"--filter",
					`label=com.docker.swarm.service.id=${state.serviceId}`,
				]).stdout.trim();
				if (!tasks) break;
				await sleep(500);
			}
			ensure(!tasks, "Proof task containers remain after project cleanup");
		}
		for (const network of state.networks ?? []) {
			const remainingNetwork = docker(["network", "inspect", network.id], { allowFailure: true });
			ensure(
				remainingNetwork.status !== 0 && /no such network|not found/i.test(remainingNetwork.stderr),
				"Proof environment network remains after project cleanup",
			);
		}
		state.projectCleaned = true;
	}
	if (state.encryptedStorageVerified) {
		await request(config, "POST", "organization.saveEnvironment", { env: state.originalEnv });
		const restored = sql(
			state.platform,
			`UPDATE organization SET metadata_v2=${literal(JSON.stringify(state.originalUnrelated))}
			WHERE id=${literal(state.organizationId)} AND metadata_v2::jsonb=${literal(JSON.stringify(state.expectedUnrelated))}::jsonb RETURNING id;`,
		);
		ensure(
			restored === state.organizationId,
			"Unrelated metadata changed; proof-marker cleanup refused",
		);
		ensure(
			(await request(config, "GET", "organization.environment")).env === state.originalEnv,
			"Original shared variables were not restored",
		);
		state.originalEnvironmentRestored = true;
	}
	preserveSources(state);
	await save(config, state);
}

async function after(config) {
	const state = await load(config);
	ensure(
		state.version === 1 &&
			state.status === "seeded" &&
			state.origin === config.origin &&
			state.candidateBootRejectionsVerified === true &&
			state.candidateTargetImage === config.targetImage,
		"Private before-state does not match this upgrade",
	);
	const current = platform();
	ensure(equal(current, state.platform), "Canonical services/PostgreSQL task identity changed");
	requireCandidateImage(candidateImage(config).Id, state.candidateImageId);
	state.runningCandidateRoles = runningCandidateRoles(state.candidateImageId);
	let failed = null;
	try {
		const loaded = await request(config, "GET", "organization.environment");
		ensure(
			loaded.organizationId === state.organizationId && loaded.env === state.expectedEnv,
			"New API did not decrypt the exact inherited legacy variables",
		);
		const rows = parse(
			sql(
				current,
				`SELECT coalesce(json_agg(row_to_json(o)), '[]') FROM
			(SELECT organization.metadata_v2, organization_environment.env AS ciphertext FROM organization
			JOIN organization_environment ON organization_environment.organization_id=organization.id
			WHERE organization.id=${literal(state.organizationId)}) o;`,
			),
			"Encrypted organization storage",
		);
		ensure(
			rows.length === 1 && /^v\d+:/.test(rows[0].ciphertext),
			"Organization variables are not encrypted at rest",
		);
		ensure(
			!rows[0].ciphertext.includes(`upgrade-env-${state.nonce}`),
			"Ciphertext contains the plaintext canary",
		);
		const metadata = parse(rows[0].metadata_v2, "Migrated metadata");
		ensure(
			!Object.hasOwn(metadata, "env") && equal(metadata, state.expectedUnrelated),
			"Unrelated metadata was changed or legacy plaintext retained",
		);
		state.encryptedStorageVerified = true;
		for (const statement of [
			`SELECT metadata FROM organization WHERE id=${literal(state.organizationId)};`,
			`UPDATE organization SET metadata='{}' WHERE id=${literal(state.organizationId)};`,
		])
			sql(current, `BEGIN; ${statement} ROLLBACK;`, {
				expectedError: /column "metadata".*does not exist/i,
			});
		const probeId = `upgrade-fence-${state.nonce}`;
		sql(
			current,
			`BEGIN; INSERT INTO deployment(deployment_id,title,status,log_path,app_name)
			VALUES(${literal(probeId)},'Upgrade fence','queued','/tmp/upgrade-fence',${literal(probeId)});
			UPDATE deployment SET status='running' WHERE deployment_id=${literal(probeId)}; ROLLBACK;`,
			{ expectedError: /worker predates encrypted organization variables/i },
		);
		ensure(
			sql(current, `SELECT count(*) FROM deployment WHERE deployment_id=${literal(probeId)};`) ===
				"0",
			"Fence probe left a deployment row",
		);
		state.fencesVerified = true;
		preserveSources(state);
		const name = `Organization upgrade proof ${state.nonce}`;
		const absent = docker(["service", "inspect", `upgrade-env-${state.nonce}`], {
			allowFailure: true,
		});
		ensure(
			absent.status !== 0 && /no such service/i.test(absent.stderr),
			"Proof application service name is not absent",
		);
		state.project = await request(config, "POST", "project.create", { name });
		ensure(state.project.projectId && state.project.name === name, "Proof project creation failed");
		await save(config, state);
		state.application = await request(config, "POST", "application.create", {
			projectId: state.project.projectId,
			environmentName: "production",
			name: "Inherited upgrade variables",
			appName: `upgrade-env-${state.nonce}`,
		});
		ensure(state.application.applicationId, "Proof application creation failed");
		await save(config, state);
		await request(config, "POST", "application.saveSource", {
			applicationId: state.application.applicationId,
			sourceType: "docker",
			dockerImage: IMAGE,
		});
		const job = await request(config, "POST", "application.deploy", {
			applicationId: state.application.applicationId,
		});
		ensure(typeof job.deploymentId === "string", "Updated deployment API is unsupported");
		state.deploymentId = job.deploymentId;
		await save(config, state);
		let done = false;
		for (const until = Date.now() + config.timeout; Date.now() < until; ) {
			const outcome = await request(config, "GET", "deployment.wait", {
				deploymentId: job.deploymentId,
				waitMs: 1000,
				logLines: 0,
			});
			if (outcome.status === "done") {
				done = true;
				break;
			}
			ensure(
				["queued", "running"].includes(outcome.status),
				"Updated-worker proof deployment failed",
			);
			await sleep(500);
		}
		ensure(done, "Updated-worker proof deployment timed out");
		const service = inspectService(state.application.appName);
		state.serviceId = service.ID;
		state.networks = [];
		for (const attachment of service.Spec.TaskTemplate.Networks ?? []) {
			const [network] = parse(
				docker(["network", "inspect", attachment.Target]).stdout,
				"Proof network inspection",
			);
			const expectedName = `production-${state.application.environmentId.replaceAll("-", "").slice(0, 8)}-net`;
			ensure(
				network.Name === expectedName,
				"Unrouted proof application joined an unexpected network",
			);
			state.networks.push({ id: network.Id, name: network.Name, createdAt: network.Created });
		}
		const desired = docker([
			"service",
			"ps",
			"--no-trunc",
			"--filter",
			"desired-state=running",
			"--format",
			"{{.ID}}",
			service.ID,
		])
			.stdout.trim()
			.split("\n")
			.filter(Boolean);
		const ids = docker([
			"ps",
			"-q",
			"--no-trunc",
			"--filter",
			`label=com.docker.swarm.service.id=${service.ID}`,
		])
			.stdout.trim()
			.split("\n")
			.filter(Boolean);
		const tasks = ids
			.map((id) => parse(docker(["inspect", id]).stdout, "Proof task inspection")[0])
			.filter((task) => desired.includes(task.Config.Labels["com.docker.swarm.task.id"]));
		ensure(
			desired.length === 1 && tasks.length === 1 && tasks[0].State.Running,
			"Updated-worker task did not converge locally",
		);
		const env = Object.fromEntries(
			tasks[0].Config.Env.map((entry) => {
				const split = entry.indexOf("=");
				return [entry.slice(0, split), entry.slice(split + 1)];
			}),
		);
		for (const [key, value] of Object.entries(state.expectedValues))
			ensure(env[key] === value, "Inherited canary bytes differ in the real task");
		ensure(
			tasks[0].Config.Labels["io.nixploy.deployment-revision"] === job.deploymentId,
			"Task does not carry the new deployment revision",
		);
		state.task = { id: tasks[0].Id, createdAt: tasks[0].Created };
		state.realTaskVariablesVerified = true;
	} catch (error) {
		failed = error;
	} finally {
		try {
			await cleanup(config, state);
		} catch (error) {
			failed ??= error;
			state.cleanupFailed = true;
		}
		state.status = failed ? "failed" : "complete";
		await save(config, state);
	}
	if (failed) throw failed;
	console.log(
		JSON.stringify({
			mode: "after",
			encryptedStorage: true,
			legacyReadWriteFences: true,
			oldWorkerClaimFence: true,
			inheritedTaskVariables: Object.keys(state.expectedValues).length,
			updatedWorkerDeployment: true,
			projectCleaned: true,
			originalEnvironmentRestored: true,
			originalIdentitiesPreserved: true,
			originalServicesPreserved: true,
		}),
	);
}

async function selfTest() {
	let pureChecks = 0;
	const check = (condition, message) => {
		ensure(condition, message);
		pureChecks++;
	};
	const generated = canaries("abcd1234");
	check(Object.keys(generated.values).length === 5, "Canary coverage changed");
	for (const line of generated.env.split("\n")) {
		const split = line.indexOf("=");
		check(
			JSON.parse(line.slice(split + 1)) === generated.values[line.slice(0, split)],
			"Canary quoting changed",
		);
	}
	check(literal("a'b$`\n") === "'a''b$`\n'", "SQL string quoting changed");
	const base = {
		UPGRADE_PROOF_DISPOSABLE: "1",
		NIXPLOY_URL: "https://127.0.0.1",
		NIXPLOY_API_KEY: "test",
		UPGRADE_PROOF_TARGET_IMAGE: "localhost:5000/nixploy:ci",
		RUNNER_TEMP: "/tmp",
	};
	check(configuration(base).origin === "https://127.0.0.1", "Loopback configuration rejected");
	for (const patch of [
		{ UPGRADE_PROOF_DISPOSABLE: "0" },
		{ NIXPLOY_URL: "https://example.com" },
		{ NIXPLOY_URL: "http://user:password@127.0.0.1" },
		{ DOCKER_HOST: "ssh://production" },
		{ UPGRADE_PROOF_TARGET_IMAGE: undefined },
		{ UPGRADE_PROOF_TARGET_IMAGE: "ghcr.io/example/nixploy:candidate" },
		{ UPGRADE_PROOF_TARGET_IMAGE: "--privileged" },
		{ UPGRADE_PROOF_TARGET_IMAGE: "localhost:5000/nixploy:ci --privileged" },
		{ UPGRADE_PROOF_TARGET_IMAGE: "localhost:5000/$(unsafe):ci" },
		{ UPGRADE_PROOF_TARGET_IMAGE: "localhost:5000/nixploy:ci\n" },
		{ UPGRADE_PROOF_TARGET_IMAGE: "localhost:99999/nixploy:ci" },
		{ UPGRADE_PROOF_TARGET_IMAGE: "localhost:5000/nixploy" },
	]) {
		let rejected = false;
		try {
			configuration({ ...base, ...patch });
		} catch {
			rejected = true;
		}
		check(rejected, "Unsafe upgrade configuration accepted");
	}
	check(
		targetImageReference(`127.0.0.1:5000/nixploy@sha256:${"a".repeat(64)}`).includes("@sha256:"),
		"Digest-pinned loopback candidate rejected",
	);
	check(
		equal(runtimeEnvironment(["DATABASE_URL=fixture", "DATABASE_URL=fixture", "VALUE=a=b"]), {
			DATABASE_URL: "fixture",
			VALUE: "a=b",
		}),
		"Identical installer environment duplicates rejected",
	);
	for (const entries of [
		["DATABASE_URL=one", "DATABASE_URL=two"],
		["INVALID-NAME=value"],
		["DATABASE_URL=before\0after"],
		["MISSING_SEPARATOR"],
	]) {
		let rejected = false;
		try {
			runtimeEnvironment(entries);
		} catch {
			rejected = true;
		}
		check(rejected, "Ambiguous or invalid runtime environment accepted");
	}
	const image = {
		Id: `sha256:${"a".repeat(64)}`,
		Config: { Entrypoint: ["/app/entrypoint.sh"], Cmd: ["tsx", "server.ts"] },
	};
	requireCandidateImage(image.Id, image.Id);
	check(true, "Immutable candidate image rejected");
	let mismatchedImageRejected = false;
	try {
		requireCandidateImage(`sha256:${"b".repeat(64)}`, image.Id);
	} catch {
		mismatchedImageRejected = true;
	}
	check(mismatchedImageRejected, "A different image under the same candidate tag was accepted");
	const record = {
		name: "upgrade-reject-fixture-panel",
		label: "fixture:panel",
		imageId: image.Id,
	};
	const container = {
		Id: "c".repeat(64),
		Name: `/${record.name}`,
		Image: image.Id,
		Config: {
			...image.Config,
			Labels: { [BOOT_PROBE_LABEL]: record.label },
			Env: ["NIXPLOY_ROLE=panel"],
		},
		HostConfig: {
			AutoRemove: true,
			NetworkMode: "nixploy-internal",
			Privileged: false,
			PortBindings: {},
		},
		Mounts: [],
	};
	ownedBootContainer(container, record, image);
	check(true, "Exact uncertain-create ownership was rejected");
	for (const changed of [
		{ ...container, Name: "/unowned" },
		{ ...container, Image: `sha256:${"b".repeat(64)}` },
		{
			...container,
			Config: { ...container.Config, Labels: { [BOOT_PROBE_LABEL]: "other:panel" } },
		},
		{ ...container, Config: { ...container.Config, Cmd: ["custom-command"] } },
		{ ...container, HostConfig: { ...container.HostConfig, NetworkMode: "host" } },
		{ ...container, Config: { ...container.Config, Env: ["NIXPLOY_UPGRADE_DRAINED=0048"] } },
	]) {
		let rejected = false;
		try {
			ownedBootContainer(changed, record, image);
		} catch {
			rejected = true;
		}
		check(rejected, "Unowned or non-default boot container accepted for adoption");
	}
	const lookups = [];
	const adopted = await findUncertainBootContainer(
		record,
		image,
		(args) => {
			lookups.push(args);
			return lookups.length === 1
				? { status: 1, stderr: "No such object" }
				: { status: 0, stdout: JSON.stringify([container]) };
		},
		async () => {},
	);
	check(
		adopted.Id === container.Id && lookups.length === 2,
		"Late create was not recovered after an initial missing result",
	);
	check(
		lookups.every((args) => equal(args, ["inspect", record.name])),
		"Uncertain create used a broad lookup",
	);
	let missingRejected = false,
		missingLookups = 0;
	try {
		await findUncertainBootContainer(
			record,
			image,
			() => {
				missingLookups++;
				return { status: 1, stderr: "No such container" };
			},
			async () => {},
		);
	} catch {
		missingRejected = true;
	}
	check(
		missingRejected && missingLookups === 10,
		"Unresolved create did not fail after the bounded lookup window",
	);
	console.log(JSON.stringify({ selfTest: true, pureChecks, dockerCalls: 0, httpCalls: 0 }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const mode = process.argv[2];
		if (mode === "--self-test") await selfTest();
		else {
			ensure(mode === "before" || mode === "after", "Expected before, after, or --self-test");
			const config = configuration(process.env);
			if (mode === "before") await before(config);
			else await after(config);
		}
	} catch (error) {
		console.error(
			`Organization upgrade proof failed: ${error instanceof Error ? error.message : "verification error"}`,
		);
		process.exitCode = 1;
	}
}
