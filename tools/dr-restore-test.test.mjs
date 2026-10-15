import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const script = fileURLToPath(new URL("./dr-restore-test.sh", import.meta.url));
const encryptionKey = "0123456789abcdef".repeat(4);
const priorEncryptionKey = "fedcba9876543210".repeat(4);
const authSecret = "fixture-auth-secret-used-only-by-stub-tests";

async function rehearsal(options, verify) {
	const directory = await mkdtemp(path.join(tmpdir(), "nixploy-dr-script-"));
	try {
		const bin = path.join(directory, "bin");
		await mkdir(bin);
		const callsPath = path.join(directory, "calls.jsonl");
		const recoveryCallsPath = path.join(directory, "recovery.jsonl");
		await writeFile(
			path.join(bin, "docker"),
			`#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args=process.argv.slice(2);
appendFileSync(process.env.DR_CALLS,JSON.stringify(args)+'\\n');
if(args[0]==='service') {
  if(process.env.DR_SCENARIO!=='apply-recovery') process.exit(1);
  if(args[1]==='update') appendFileSync(process.env.DR_RECOVERY_CALLS,JSON.stringify({service:args.at(-1),chain:process.env.ENCRYPTION_KEYS,single:process.env.ENCRYPTION_KEY,auth:process.env.BETTER_AUTH_SECRET})+'\\n');
  process.exit(0);
}
if(args[0]==='run') {
  const name=args[args.indexOf('--name')+1];
  if(name.endsWith('-panel') && process.env.DR_SCENARIO==='boot-fails') process.exit(1);
  console.log('fixture-container');
} else if(args[0]==='inspect') {
  console.log('false');
} else if(args[0]==='exec' && args.includes('curl')) {
  process.stdout.write(process.env.DR_SCENARIO==='not-ready'?'503':'200');
} else if(args[0]==='exec' && args.includes('psql')) {
  if(args.includes('-c')) {
    const query=args[args.indexOf('-c')+1];
    console.log(query.includes('to_regclass')?'t':query.includes('information_schema')?'42':'1');
  } else {
    process.stdin.resume();
    process.stdin.on('end',()=>process.exit(process.env.DR_SCENARIO==='sql-fails'?1:0));
  }
}
`,
			{ mode: 0o700 },
		);
		await writeFile(
			path.join(bin, "curl"),
			"#!/usr/bin/env node\nprocess.stderr.write('Readiness must run inside the isolated panel container');\nprocess.exit(99);\n",
			{ mode: 0o700 },
		);
		const dump = path.join(directory, "instance.sql.gz");
		await writeFile(dump, options.corrupt ? "not gzip" : gzipSync("-- fixture SQL\n"));
		const recoveryEnv = path.join(directory, "recovery.keys");
		await writeFile(
			recoveryEnv,
			options.recoveryContents ??
				`ENCRYPTION_KEYS=${encryptionKey},${priorEncryptionKey}\nBETTER_AUTH_SECRET=${authSecret}\n`,
			{ mode: 0o600 },
		);
		const args = ["--dump", dump];
		if (options.boot) args.push("--boot");
		if (!options.omitRecovery) args.push("--recovery-env", recoveryEnv);
		if (!options.omitSocket) args.push("--docker-socket", "/disposable/docker.sock");
		if (!options.omitImage) args.push("--panel-image", "fixture/panel@sha256:pinned");
		if (options.autoDiscover) {
			const backups = path.join(directory, "backups");
			await mkdir(path.join(backups, "web-server"), { recursive: true });
			await mkdir(path.join(backups, "web-server-config"), { recursive: true });
			await writeFile(path.join(backups, "web-server", "older.gz"), gzipSync("-- SQL\n"));
			await utimes(path.join(backups, "web-server", "older.gz"), 1, 1);
			await writeFile(path.join(backups, "web-server-config", "newer.gz"), gzipSync("not SQL"));
			args.splice(0, 2, "--dir", backups);
		}
		let bashArgs = [script, ...args];
		if (options.recoveryUpdate) {
			const docs = await readFile(new URL("../docs/instance-backup.md", import.meta.url), "utf8");
			const block = [...docs.matchAll(/```bash\n([\s\S]*?)```/g)].find((match) =>
				match[1].includes("recovery_names="),
			)?.[1];
			assert.ok(block, "Recovery environment instructions are missing");
			const quotedRecoveryEnv = `'${recoveryEnv.replaceAll("'", "'\\''")}'`;
			bashArgs = [
				"-euo",
				"pipefail",
				"-c",
				block.replace("/secure/recovery.keys", quotedRecoveryEnv),
			];
		}
		const result = spawnSync("bash", bashArgs, {
			encoding: "utf8",
			timeout: 15_000,
			env: {
				...process.env,
				PATH: `${bin}${path.delimiter}${process.env.PATH}`,
				DR_CALLS: callsPath,
				DR_RECOVERY_CALLS: recoveryCallsPath,
				DR_SCENARIO: options.scenario ?? "success",
				ENCRYPTION_KEYS: "stale-inherited-chain",
				ENCRYPTION_KEY: "stale-inherited-single-key",
				NO_COLOR: "1",
			},
		});
		const calls = (await readFile(callsPath, "utf8").catch(() => ""))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const recoveryCalls = await readFile(recoveryCallsPath, "utf8").catch(() => "");
		await verify({
			...result,
			output: `${result.stdout}${result.stderr}`,
			calls,
			recoveryCalls: recoveryCalls.trim() ? recoveryCalls.trim().split("\n").map(JSON.parse) : [],
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function assertScratchCleanup(calls) {
	const postgres = calls.find((args) => args[0] === "run" && !args.includes("NIXPLOY_ROLE=panel"));
	assert.ok(postgres, "Scratch Postgres was not created");
	const name = postgres[postgres.indexOf("--name") + 1];
	assert.match(name, /^nixploy-dr-[a-f0-9]{8}$/);
	assert.deepEqual(
		calls.filter((args) => args[0] === "rm"),
		[
			["rm", "-fv", `${name}-panel`],
			["rm", "-fv", name],
		],
		"Cleanup must remove only both owned containers and their anonymous volumes",
	);
}

test("requested boot fails when an image cannot be resolved", async () => {
	await rehearsal({ boot: true, omitImage: true }, ({ status, output, calls }) => {
		assert.notEqual(status, 0);
		assert.match(output, /could not resolve a panel image/);
		assert.doesNotMatch(output, /DR restore test passed/);
		assert.equal(
			calls.some((args) => args[0] === "run"),
			false,
		);
	});
});

for (const [scenario, diagnostic] of [
	["boot-fails", /Could not start the requested panel container/],
	["not-ready", /Panel did not become ready/],
	["sql-fails", /Restore FAILED/],
]) {
	test(`${scenario} never prints a passing restore verdict`, async () => {
		await rehearsal({ boot: true, scenario }, ({ status, output, calls }) => {
			assert.notEqual(status, 0);
			assert.match(output, diagnostic);
			assert.doesNotMatch(output, /DR restore test passed/);
			assertScratchCleanup(calls);
			assert.ok(calls.some((args) => args[0] === "network" && args[1] === "rm"));
		});
	});
}

for (const options of [
	{ omitRecovery: true },
	{ omitSocket: true },
	{ recoveryContents: `ENCRYPTION_KEYS="${encryptionKey}"\nBETTER_AUTH_SECRET=${authSecret}\n` },
	{ recoveryContents: `ENCRYPTION_KEYS='${encryptionKey}'\nBETTER_AUTH_SECRET=${authSecret}\n` },
	{
		recoveryContents: `export ENCRYPTION_KEY=${encryptionKey}\nBETTER_AUTH_SECRET=${authSecret}\n`,
	},
	{ recoveryContents: `ENCRYPTION_KEY=${encryptionKey}\n` },
	{
		recoveryContents: `ENCRYPTION_KEY=${encryptionKey}\nBETTER_AUTH_SECRET=${authSecret}\nPORT=3000\n`,
	},
]) {
	test(`boot rejects incomplete or shell-format recovery inputs: ${JSON.stringify(Object.keys(options))}`, async () => {
		await rehearsal({ boot: true, ...options }, ({ status, output, calls }) => {
			assert.notEqual(status, 0);
			assert.doesNotMatch(output, /DR restore test passed/);
			assert.equal(
				calls.some((args) => args[0] === "run"),
				false,
			);
		});
	});
}

test("successful readiness uses supplied keys off argv and cannot claim worker jobs", async () => {
	await rehearsal({ boot: true }, ({ status, output, calls }) => {
		assert.equal(status, 0, output);
		assertScratchCleanup(calls);
		assert.match(output, /Readiness only: authenticate, check decrypted secrets/);
		const panel = calls.find((args) => args[0] === "run" && args.includes("NIXPLOY_ROLE=panel"));
		assert.ok(panel);
		assert.ok(panel.includes("--env-file"));
		assert.ok(
			panel.includes(
				"type=bind,source=/disposable/docker.sock,target=/var/run/docker.sock,readonly",
			),
		);
		assert.ok(panel.includes("fixture/panel@sha256:pinned"));
		assert.equal(panel.includes("-p"), false, "The isolated panel must not publish a host port");
		assert.ok(panel.includes("BETTER_AUTH_URL=http://127.0.0.1:3000"));
		const panelName = panel[panel.indexOf("--name") + 1];
		assert.deepEqual(
			calls.filter((args) => args[0] === "exec" && args.includes("curl")),
			[
				[
					"exec",
					panelName,
					"curl",
					"-s",
					"-o",
					"/dev/null",
					"-w",
					"%{http_code}",
					"--max-time",
					"5",
					"http://127.0.0.1:3000/api/ready",
				],
			],
		);
		assert.ok(calls.some((args) => args[0] === "network" && args.includes("--internal")));
		assert.equal(JSON.stringify(calls).includes(encryptionKey), false);
		assert.equal(JSON.stringify(calls).includes(priorEncryptionKey), false);
		assert.equal(JSON.stringify(calls).includes(authSecret), false);
		const restores = calls.filter(
			(args) => args[0] === "exec" && args.includes("psql") && !args.includes("-c"),
		);
		assert.equal(restores.length, 2);
		assert.ok(
			restores.every(
				(args) => args.includes("--single-transaction") && args.includes("ON_ERROR_STOP=1"),
			),
		);
	});
});

test("boot accepts the original single-key recovery format", async () => {
	await rehearsal(
		{
			boot: true,
			recoveryContents: `ENCRYPTION_KEY=${encryptionKey}\nBETTER_AUTH_SECRET=${authSecret}\n`,
		},
		({ status, output }) => assert.equal(status, 0, output),
	);
});

test("auto-discovery ignores a newer config archive", async () => {
	await rehearsal({ autoDiscover: true }, ({ status, output }) => {
		assert.equal(status, 0, output);
		assert.match(output, /web-server\/older\.gz/);
		assert.doesNotMatch(output, /web-server-config\/newer\.gz/);
	});
});

test("corrupt gzip fails before any scratch container starts", async () => {
	await rehearsal({ corrupt: true }, ({ status, output, calls }) => {
		assert.notEqual(status, 0);
		assert.match(output, /Not a valid gzip file/);
		assert.equal(
			calls.some((args) => args[0] === "run"),
			false,
		);
	});
});

for (const [label, recoveryContents, expected] of [
	[
		"key chain",
		`ENCRYPTION_KEYS=${encryptionKey},${priorEncryptionKey}\nBETTER_AUTH_SECRET=${authSecret}\n`,
		{ chain: `${encryptionKey},${priorEncryptionKey}`, auth: authSecret },
	],
	[
		"single key",
		`ENCRYPTION_KEY=${encryptionKey}\nBETTER_AUTH_SECRET=${authSecret}\n`,
		{ single: encryptionKey, auth: authSecret },
	],
	[
		"literal value without shell execution",
		`ENCRYPTION_KEY=${encryptionKey}\nBETTER_AUTH_SECRET=$(exit 99)\n`,
		{ single: encryptionKey, auth: "$(exit 99)" },
	],
]) {
	test(`documented ${label} recovery updates both stopped service environments without secret argv`, async () => {
		await rehearsal(
			{ recoveryUpdate: true, scenario: "apply-recovery", recoveryContents },
			({ status, output, calls, recoveryCalls }) => {
				assert.equal(status, 0, output);
				assert.deepEqual(recoveryCalls, [
					{ service: "nixploy", ...expected },
					{ service: "nixploy-worker", ...expected },
				]);
				const updates = calls.filter((args) => args[1] === "update");
				assert.equal(updates.length, 2);
				assert.ok(updates.every((args) => args[args.indexOf("--replicas") + 1] === "0"));
				assert.equal(JSON.stringify(calls).includes(encryptionKey), false);
				assert.equal(JSON.stringify(calls).includes(priorEncryptionKey), false);
				assert.equal(JSON.stringify(calls).includes(authSecret), false);
			},
		);
	});
}

for (const recoveryContents of [
	`ENCRYPTION_KEYS="${encryptionKey}"\nBETTER_AUTH_SECRET=${authSecret}\n`,
	`ENCRYPTION_KEY=${encryptionKey}\n`,
]) {
	test("documented recovery rejects invalid inputs before changing either service", async () => {
		await rehearsal(
			{ recoveryUpdate: true, scenario: "apply-recovery", recoveryContents },
			({ status, recoveryCalls }) => {
				assert.notEqual(status, 0);
				assert.deepEqual(recoveryCalls, []);
			},
		);
	});
}
