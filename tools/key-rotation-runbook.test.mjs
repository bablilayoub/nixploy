import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const docs = await readFile(new URL("../docs/auth.md", import.meta.url), "utf8");
const blocks = [...docs.matchAll(/```bash\n([\s\S]*?)```/g)]
	.map((match) => match[1])
	.filter((block) => block.includes("# rotation:"));
assert.equal(blocks.length, 3, "Expected prepare, rewrite and resume instructions");
const oldKey = "0123456789abcdef".repeat(4);
const newKey = "fedcba9876543210".repeat(4);

async function rehearsal(options, verify) {
	const directory = await mkdtemp(path.join(tmpdir(), "nixploy-rotation-docs-"));
	try {
		const bin = path.join(directory, "bin");
		await mkdir(bin);
		const statePath = path.join(directory, "services.json");
		const callsPath = path.join(directory, "calls.jsonl");
		const services = {
			nixploy: {
				id: "panel-original-id",
				replicas: options.panelReplicas ?? 2,
				env: [
					"DATABASE_URL=postgres://fixture:private-password@fixture/fixture",
					`ENCRYPTION_KEY=${oldKey}`,
					`NIXPLOY_ROLE=${options.split === false ? "all" : "panel"}`,
					"BETTER_AUTH_SECRET=unchanged-auth-secret",
				],
			},
		};
		if (options.duplicateDatabase) {
			services.nixploy.env.push(
				options.duplicateDatabase === "identical"
					? services.nixploy.env[0]
					: "DATABASE_URL=postgres://fixture:private-password@other/fixture",
			);
		}
		if (options.split !== false) {
			services["nixploy-worker"] = {
				id: "worker-original-id",
				replicas: options.workerReplicas ?? 1,
				env: [`NIXPLOY_ROLE=worker`, `ENCRYPTION_KEY=${oldKey}`],
			};
		}
		await writeFile(statePath, JSON.stringify(services), { mode: 0o600 });
		await writeFile(
			path.join(bin, "docker"),
			`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ROTATION_CALLS, JSON.stringify(args) + '\\n');
const state = JSON.parse(fs.readFileSync(process.env.ROTATION_STATE, 'utf8'));
const save = () => fs.writeFileSync(process.env.ROTATION_STATE, JSON.stringify(state));
const fail = message => { console.error(message); process.exit(1); };
if (args[0] === 'network') { console.log('true'); }
else if (args[0] === 'node') { console.log(process.env.ROTATION_SCENARIO === 'node-unreachable' || (process.env.ROTATION_SCENARIO === 'node-lost-after-drain' && Object.values(state).every(s => s.replicas === 0)) ? 'down' : 'ready'); }
else if (args[0] === 'inspect' && args.includes('task')) { console.log('fixture-node-id'); }
else if (args[0] === 'service' && args[1] === 'ls') { console.log(Object.keys(state).join('\\n')); }
else if (args[0] === 'service' && args[1] === 'inspect') {
 const service = state[args.at(-1)]; if (!service) fail('missing service');
 const format = args[args.indexOf('--format') + 1];
 if (format.includes('ContainerSpec.Image')) console.log('sha256:fixture-pinned-image');
 else if (format.includes('Replicas')) console.log(service.replicas);
 else if (format.includes('ContainerSpec.Env')) console.log(service.env.join('\\n'));
 else if (format === '{{.ID}}') console.log(service.id);
 else fail('Unexpected inspect');
} else if (args[0] === 'service' && args[1] === 'scale') {
 for (const entry of args.slice(2).filter(a => !a.startsWith('--'))) {
  const [name, count] = entry.split('='); state[name].replicas = Number(count);
 } save();
} else if (args[0] === 'service' && args[1] === 'ps') {
 if (args.includes('{{.ID}}')) console.log('fixture-task-id');
 else console.log(process.env.ROTATION_SCENARIO === 'not-stopped' ? 'Orphaned 1 second ago' : 'Shutdown 1 second ago');
} else if (args[0] === 'service' && args[1] === 'update') {
 const service = state[args.at(-1)];
 const priorKey = service.env.find(e => e.startsWith('ENCRYPTION_KEY='));
 if (service.replicas !== 0) fail('Updated a live writer');
 service.env = service.env.filter(e => !e.startsWith('ENCRYPTION_KEY=') && !e.startsWith('ENCRYPTION_KEYS='));
 service.env.push('ENCRYPTION_KEYS=' + process.env.ENCRYPTION_KEYS);
 if (process.env.ROTATION_SCENARIO === 'stale-single-key' && priorKey) service.env.push(priorKey);
 if (process.env.ROTATION_SCENARIO === 'wrong-stored-chain') service.env[service.env.length-1] = 'ENCRYPTION_KEYS=stale';
 save();
} else if (args[0] === 'run') {
 if (Object.values(state).some(s => s.replicas !== 0)) fail('Rotated with a live writer');
 const content = fs.readFileSync(args[args.indexOf('--env-file')+1], 'utf8');
 const chain = content.match(/^ENCRYPTION_KEYS=(.+)$/m)?.[1];
 const databases = content.split('\\n').filter(line => line.startsWith('DATABASE_URL='));
 if (!chain || databases.length !== 1 || databases[0] !== 'DATABASE_URL=postgres://fixture:private-password@fixture/fixture') fail('Ambiguous or missing private input');
 const dryRun = args.includes('--dry-run');
 if (process.env.ROTATION_SCENARIO === 'rotation-fails' && !dryRun) fail('Fixture lost key');
 if (process.env.ROTATION_SCENARIO === 'new-key-fails' && !chain.includes(',')) fail('New primary cannot decrypt');
 fs.appendFileSync(process.env.ROTATION_CALLS, JSON.stringify({phase: dryRun ? 'verify' : 'rewrite', keys: chain.includes(',') ? 2 : 1}) + '\\n');
 console.log('fixture: ciphertext verified');
} else fail('Unexpected Docker invocation');
`,
			{ mode: 0o700 },
		);
		// Never sleep for the two-minute operator timeout in a stub rehearsal.
		await writeFile(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
		const keys = path.join(directory, "rotation.keys");
		await writeFile(keys, options.keyContents ?? `ENCRYPTION_KEYS=${newKey},${oldKey}\n`, {
			mode: 0o600,
		});
		const quoted = (value) => `'${value.replaceAll("'", "'\\''")}'`;
		const source = blocks
			.join("\n")
			.replace("rotation_keys=/secure/rotation.keys", `rotation_keys=${quoted(keys)}`)
			.replace('rotation_dir="$(mktemp -d)"', `rotation_dir=${quoted(directory)}`);
		const result = spawnSync("bash", ["-c", source], {
			encoding: "utf8",
			timeout: 120_000,
			env: {
				...process.env,
				PATH: `${bin}${path.delimiter}${process.env.PATH}`,
				ROTATION_CALLS: callsPath,
				ROTATION_STATE: statePath,
				ROTATION_SCENARIO: options.scenario ?? "success",
				ENCRYPTION_KEY: "stale-inherited-key",
				ENCRYPTION_KEYS: "stale-inherited-chain",
			},
		});
		const calls = (await readFile(callsPath, "utf8").catch(() => ""))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const state = JSON.parse(await readFile(statePath, "utf8"));
		const output = `${result.stdout}${result.stderr}`;
		assert.equal(JSON.stringify(calls).includes(oldKey), false, "Old key leaked in argv");
		assert.equal(JSON.stringify(calls).includes(newKey), false, "New key leaked in argv");
		assert.equal(output.includes(oldKey), false, "Old key leaked in logs");
		assert.equal(output.includes(newKey), false, "New key leaked in logs");
		assert.equal(output.includes("private-password"), false, "Database password leaked in logs");
		await verify({ ...result, output, calls, state, original: services });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

for (const options of [
	{},
	{ panelReplicas: 0, workerReplicas: 0 },
	{ panelReplicas: 1, workerReplicas: 0 },
	{ split: false },
	{ duplicateDatabase: "identical" },
]) {
	test(`documented rotation preserves original roles and replicas: ${JSON.stringify(options)}`, async () => {
		await rehearsal(options, ({ status, output, state, original, calls }) => {
			assert.equal(status, 0, output);
			for (const [name, service] of Object.entries(state)) {
				assert.equal(service.id, original[name].id);
				assert.equal(service.replicas, original[name].replicas);
				assert.deepEqual(
					service.env.filter((e) => !e.startsWith("ENCRYPTION_KEYS=")),
					original[name].env.filter((e) => !e.startsWith("ENCRYPTION_KEY=")),
				);
				assert.ok(service.env.includes(`ENCRYPTION_KEYS=${newKey},${oldKey}`));
			}
			assert.deepEqual(
				calls.filter((call) => call.phase),
				[
					{ phase: "verify", keys: 2 },
					{ phase: "rewrite", keys: 2 },
					{ phase: "verify", keys: 1 },
				],
			);
		});
	});
}

test("conflicting database entries fail preflight before changing services", async () => {
	await rehearsal({ duplicateDatabase: "conflicting" }, ({ status, state, calls, original }) => {
		assert.notEqual(status, 0);
		assert.deepEqual(state, original);
		assert.equal(
			calls.some((call) => call[1] === "scale" || call[1] === "update" || call[0] === "run"),
			false,
		);
	});
});

for (const scenario of [
	"wrong-stored-chain",
	"stale-single-key",
	"rotation-fails",
	"new-key-fails",
]) {
	test(`failure ${scenario} keeps every writer stopped`, async () => {
		await rehearsal({ scenario }, ({ status, state }) => {
			assert.notEqual(status, 0);
			assert.ok(Object.values(state).every((service) => service.replicas === 0));
		});
	});
}

test("orphaned tasks are not accepted as stopped writers", async () => {
	await rehearsal({ scenario: "not-stopped" }, ({ status, state, calls }) => {
		assert.notEqual(status, 0);
		assert.ok(Object.values(state).every((service) => service.replicas === 0));
		assert.equal(
			calls.some((call) => call[1] === "update" || call[0] === "run"),
			false,
		);
	});
});

test("unreachable writer nodes block rotation before any service changes", async () => {
	await rehearsal({ scenario: "node-unreachable" }, ({ status, calls, state, original }) => {
		assert.notEqual(status, 0);
		assert.deepEqual(state, original);
		assert.equal(
			calls.some((call) => call[1] === "scale" || call[1] === "update" || call[0] === "run"),
			false,
		);
	});
});

test("losing a writer node after drain leaves services stopped without rewriting", async () => {
	await rehearsal({ scenario: "node-lost-after-drain" }, ({ status, calls, state }) => {
		assert.notEqual(status, 0);
		assert.ok(Object.values(state).every((service) => service.replicas === 0));
		assert.equal(
			calls.some((call) => call[1] === "update" || call[0] === "run"),
			false,
		);
	});
});

for (const keyContents of [
	`ENCRYPTION_KEYS="${newKey},${oldKey}"\n`,
	`ENCRYPTION_KEYS=${newKey}\n`,
	`ENCRYPTION_KEYS=${newKey},${oldKey}\nENCRYPTION_KEYS=${newKey},${oldKey}\n`,
	`ENCRYPTION_KEYS=${newKey},${oldKey}\nDATABASE_URL=unexpected\n`,
]) {
	test("invalid private input fails before stopping services", async () => {
		await rehearsal({ keyContents }, ({ status, calls }) => {
			assert.notEqual(status, 0);
			assert.equal(calls.length, 0);
		});
	});
}

test("rotation guidance retains historical backup keys and avoids immediate key removal advice", async () => {
	assert.match(docs, /Retain old keys in the recovery vault for every historical/);
	assert.match(docs, /all writers must remain stopped/);
	const source = await readFile(
		new URL("../packages/server/src/scripts/rotate-encryption-key.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /Now drop the old key/);
});
