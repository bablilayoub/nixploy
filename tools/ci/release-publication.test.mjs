import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = await readFile(path.join(root, ".github/workflows/release.yml"), "utf8");
const release = source.slice(source.indexOf("\n  release:\n"));
const repository = "ghcr.io/bablilayoub/nixploy";
const digest = `sha256:${"c".repeat(64)}`;
const signed = `${repository}@${digest}`;
const children = ["a".repeat(64), "b".repeat(64)];

// Read this workflow's small step/map/block subset without a YAML dependency.
// Action implementations are stubbed; every inline Bash run block executes.
function mapping(text, name) {
	const match = text.match(new RegExp(`^        ${name}:\\n((?:          .*\\n|\\n)*)`, "m"));
	if (!match) return {};
	return Object.fromEntries(
		[...match[1].matchAll(/^ {10}([\w-]+): (.*)$/gm)].map(([, key, value]) => [key, value]),
	);
}

function workflowSteps(workflow) {
	const starts = [...workflow.matchAll(/^ {6}- name: (.+)$/gm)];
	assert.ok(starts.length, "Workflow job has no steps");
	return starts.map((match, index) => {
		const text = workflow.slice(match.index, starts[index + 1]?.index ?? workflow.length);
		const run = text.match(/^ {8}run: (.*)\n((?: {10}.*\n|\n)*)/m);
		return {
			name: match[1],
			id: text.match(/^ {8}id: (.+)$/m)?.[1],
			condition: text.match(/^ {8}if: (.+)$/m)?.[1],
			cwd: text.match(/^ {8}working-directory: (.+)$/m)?.[1],
			env: mapping(text, "env"),
			with: mapping(text, "with"),
			text,
			run: run ? (run[1] === "|" ? run[2].replace(/^ {10}/gm, "") : run[1]) : null,
		};
	});
}

const steps = workflowSteps(release);

const step = (name) => {
	const found = steps.find((entry) => entry.name === name);
	assert.ok(found, `Missing Release step: ${name}`);
	return found;
};
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

test("Reusable checks run workflow contracts when the selected product tag predates them", async (t) => {
	const checks = workflowSteps(
		await readFile(path.join(root, ".github/workflows/checks.yml"), "utf8"),
	);
	const product = checks.find((entry) => entry.name === "Checkout");
	const tooling = checks.find((entry) => entry.name === "Checkout workflow contract tooling");
	assert.equal(product?.with.ref, `\${{ inputs.ref }}`);
	assert.equal(tooling?.with.ref, `\${{ github.workflow_sha }}`);
	assert.equal(tooling.with["persist-credentials"], "false");
	assert.ok(checks.indexOf(tooling) > checks.findIndex((entry) => entry.name === "Web tests"));

	const directory = await mkdtemp(path.join(tmpdir(), "nixploy-workflow-contracts-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const workspace = path.join(directory, "historical product tag");
	await mkdir(workspace);
	const checkout = path.join(workspace, tooling.with.path);
	const files = [
		"tools/dr-restore-test.test.mjs",
		"tools/ci/image-signature.test.mjs",
		"tools/ci/release-publication.test.mjs",
		"tools/ci/organization-upgrade-proof.mjs",
	];
	for (const file of files) {
		assert.equal(existsSync(path.join(workspace, file)), false);
		await mkdir(path.dirname(path.join(checkout, file)), { recursive: true });
		await writeFile(
			path.join(checkout, file),
			file.endsWith("organization-upgrade-proof.mjs")
				? 'if (process.argv[2] !== "--self-test") throw new Error("Expected pure self-test");\n'
				: `import test from "node:test";\ntest(${JSON.stringify(file)}, () => {});\n`,
		);
	}
	for (const name of [
		"Disaster recovery rehearsal contract",
		"Release publication contracts",
		"Organization upgrade proof contract",
	]) {
		const contract = checks.find((entry) => entry.name === name);
		assert.ok(contract?.run, `Missing required contract: ${name}`);
		assert.ok(checks.indexOf(contract) > checks.indexOf(tooling));
		assert.equal(contract.condition, undefined);
		const execute = (cwd) =>
			spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", contract.run], {
				cwd,
				env: { PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter) },
				encoding: "utf8",
				timeout: 10_000,
			});
		const legacy = execute(workspace);
		assert.ifError(legacy.error);
		assert.notEqual(
			legacy.status,
			0,
			"Fixture product tag unexpectedly contains workflow contracts",
		);
		const result = execute(path.resolve(workspace, contract.cwd ?? "."));
		assert.ifError(result.error);
		// Node's default reporter differs across supported versions.
		assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
	}
});

const stub = String.raw`
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const tool = process.argv[2], args = process.argv.slice(3), env = process.env;
const record = (event) => appendFileSync(env.PUBLICATION_CALLS, JSON.stringify(event) + "\n");
const fail = (message, code = 99) => { console.error(message); process.exit(code); };
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
if (tool === "sha256sum") {
  if (JSON.stringify(args) !== JSON.stringify(["install.sh", "update.sh", "uninstall.sh"])) fail("Unexpected checksum inputs");
  record({ kind: "checksums", files: args });
  for (const file of args) console.log(hash(file) + "  " + file);
} else if (tool === "docker") {
  if (args.splice(0, 3).join(" ") !== "buildx imagetools create") fail("Unexpected Docker operation");
  const tags = [], images = []; let metadata;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tag" || args[i] === "-t") tags.push(args[++i]);
    else if (args[i] === "--metadata-file") metadata = args[++i];
    else if (args[i].startsWith("-")) fail("Unexpected Docker flag");
    else images.push(args[i]);
  }
  if (metadata) {
    if (metadata !== path.join(env.RUNNER_TEMP, "manifest.json")) fail("Metadata outside fixture");
    record({ kind: "stage", tags, images, digest: env.PUBLICATION_DIGEST });
    if (env.PUBLICATION_MODE !== "metadata-file-missing") {
      const descriptor = env.PUBLICATION_MODE === "metadata-missing" ? {} : {
        digest: env.PUBLICATION_MODE === "metadata-invalid" ? "not-a-digest" : env.PUBLICATION_DIGEST,
      };
      writeFileSync(metadata, JSON.stringify({ "containerimage.descriptor": descriptor }));
    }
  } else record({ kind: "promote", tags, images });
} else if (tool === "jq") {
  const query = args[1];
  if (query === '."containerimage.descriptor".digest | select(test("^sha256:[0-9a-f]{64}$"))') {
    const value = existsSync(args[2]) ? JSON.parse(readFileSync(args[2], "utf8"))["containerimage.descriptor"]?.digest : undefined;
    if (!/^sha256:[0-9a-f]{64}$/.test(value ?? "")) fail("Missing or invalid staged digest", 1);
    record({ kind: "metadata", digest: value }); console.log(value);
  } else if (query === '.tags | map("-t " + .) | join(" ")') {
    console.log(JSON.parse(readFileSync(0, "utf8")).tags.map((tag) => "-t " + tag).join(" "));
  } else fail("Unexpected jq query");
} else if (tool === "cosign") {
  if (args[0] !== "sign" || args[1] !== "--yes" || args.length !== 3) fail("Unexpected cosign operation");
  record({ kind: "sign", image: args[2] });
  if (env.PUBLICATION_MODE === "sign-failure") fail("Fixture signing failure", 41);
} else if (tool === "checker") {
  record({ kind: "verify", args });
  if (args.length !== 3 || args[2] !== env.GITHUB_WORKSPACE) fail("Verifier did not receive shipped assets");
  const expected = 'NIXPLOY_VERSION="$' + '{NIXPLOY_VERSION:-' + env.PUBLICATION_TAG + '}"';
  for (const file of ["install.sh", "update.sh"]) {
    const lines = readFileSync(path.join(args[2], file), "utf8").split("\n");
    if (!lines[0].startsWith("#!") || lines[1] !== expected) fail("Shipped installer was not pinned");
    if (lines.some((line) => line.includes("TOOLING_DEFAULT_INSTALLER"))) fail("Verified tooling instead of release assets");
  }
  const sums = readFileSync(path.join(args[2], "SHA256SUMS"), "utf8").trim().split("\n");
  if (sums.length !== 3) fail("Incomplete shipped checksums");
  for (const line of sums) {
    const [sum, file] = line.split("  ");
    if (hash(path.join(args[2], file)) !== sum) fail("Checksums differ from verified assets");
  }
  if (env.PUBLICATION_MODE === "verify-failure") fail("Fixture installer rejection", 42);
} else fail("Unknown fixture tool");
`;

async function fixture(t, { event = "push", tag = "v0.7.3", mode = "success" } = {}) {
	const directory = await mkdtemp(path.join(tmpdir(), "nixploy-release-publication-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const workspace = path.join(directory, "old tag checkout");
	const bin = path.join(directory, "bin");
	const runnerTemp = path.join(directory, "runner temp");
	const digests = path.join(directory, "digests");
	await Promise.all([workspace, bin, runnerTemp, digests].map((entry) => mkdir(entry)));
	for (const name of ["install.sh", "update.sh", "uninstall.sh"]) {
		await writeFile(
			path.join(workspace, name),
			`#!/usr/bin/env bash\nNIXPLOY_VERSION="\${NIXPLOY_VERSION:-latest}"\n# Historical ${name}\n`,
		);
	}
	for (const child of children) await writeFile(path.join(digests, child), "");
	const toolSource = path.join(directory, "stub.cjs");
	await writeFile(toolSource, stub);
	const wrapper = (name) =>
		`#!/usr/bin/env bash\nexec ${quote(process.execPath)} ${quote(toolSource)} ${quote(name)} "$@"\n`;
	for (const name of ["docker", "cosign", "jq", "sha256sum"]) {
		await writeFile(path.join(bin, name), wrapper(name), { mode: 0o700 });
	}
	const tooling = path.join(workspace, ".release-verification");
	await mkdir(path.join(tooling, "tools/ci"), { recursive: true });
	await writeFile(path.join(tooling, "install.sh"), "TOOLING_DEFAULT_INSTALLER\n");
	await writeFile(path.join(tooling, "update.sh"), "TOOLING_DEFAULT_INSTALLER\n");
	await writeFile(
		path.join(tooling, "tools/ci/check-installer-signatures.sh"),
		wrapper("checker"),
		{
			mode: 0o700,
		},
	);
	assert.equal(existsSync(path.join(workspace, "tools/ci/check-installer-signatures.sh")), false);
	const callsFile = path.join(directory, "calls.jsonl");
	const outputs = {};
	const context = { "github.event_name": event, "inputs.tag": tag };
	const render = (value) =>
		value.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) => {
			const output = expression.match(/^steps\.([\w-]+)\.outputs\.([\w-]+)$/);
			const result = output ? outputs[output[1]]?.[output[2]] : context[expression];
			assert.notEqual(result, undefined, `Unknown workflow expression: ${expression}`);
			return result;
		});
	// Explicit environment: no private credentials, shell startup hooks, Docker
	// host overrides or inherited NIXPLOY_SKIP_VERIFY can enter this harness.
	const env = {
		PATH: [bin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
		REGISTRY: "ghcr.io",
		IMAGE_NAME: "bablilayoub/nixploy",
		GITHUB_WORKSPACE: workspace,
		GITHUB_REF_NAME: tag,
		GITHUB_RUN_ID: "4242",
		GITHUB_RUN_ATTEMPT: "3",
		RUNNER_TEMP: runnerTemp,
		DOCKER_METADATA_OUTPUT_JSON: JSON.stringify({ tags: [`${repository}:${tag}`] }),
		PUBLICATION_CALLS: callsFile,
		PUBLICATION_TAG: tag,
		PUBLICATION_DIGEST: digest,
		PUBLICATION_MODE: mode,
	};
	const executed = [];
	let failure;
	for (const entry of steps) {
		if (!entry.run) continue;
		if (entry.condition) {
			const condition = entry.condition.match(/^steps\.([\w-]+)\.outputs\.([\w-]+) == '([^']*)'$/);
			assert.ok(condition, `Unsupported workflow condition: ${entry.condition}`);
			if (outputs[condition[1]]?.[condition[2]] !== condition[3]) continue;
		}
		const outputFile = path.join(directory, `output-${executed.length}`);
		await writeFile(outputFile, "");
		// Bind the workflow's fixed artifact-download path into this owned fixture.
		// All other Bash, including output handling and failures, stays unchanged.
		const script = render(entry.run).replaceAll("/tmp/digests", quote(digests));
		const result = spawnSync(
			"bash",
			["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
			{
				cwd: entry.cwd === "/tmp/digests" ? digests : workspace,
				env: {
					...env,
					...Object.fromEntries(
						Object.entries(entry.env).map(([key, value]) => [key, render(value)]),
					),
					GITHUB_OUTPUT: outputFile,
				},
				encoding: "utf8",
				timeout: 10_000,
			},
		);
		assert.ifError(result.error);
		executed.push(entry.name);
		if (result.status !== 0) {
			failure = {
				step: entry.name,
				status: result.status,
				output: `${result.stdout}${result.stderr}`,
			};
			break; // GitHub's default success condition stops subsequent steps.
		}
		if (entry.id) {
			outputs[entry.id] = Object.fromEntries(
				(await readFile(outputFile, "utf8"))
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
			);
		}
	}
	const calls = (await readFile(callsFile, "utf8")).trim().split("\n").map(JSON.parse);
	return { calls, executed, failure, outputs, tag, workspace };
}

test("Release keeps immutable tooling and the final-push latest condition wired", () => {
	assert.equal(step("Checkout verification tooling").with.ref, `\${{ github.workflow_sha }}`);
	assert.equal(step("Checkout verification tooling").with.path, ".release-verification");
	assert.equal(step("Checkout verification tooling").with["persist-credentials"], "false");
	assert.equal(step("Checkout").with.ref, `\${{ steps.tag.outputs.tag }}`);
	assert.equal(
		step("Image tags and labels").with.images,
		`\${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}`,
	);
	assert.equal(step("Image tags and labels").with.flavor, "latest=false");
	assert.equal(
		step("Image tags and labels")
			.text.match(/^ {10}tags: \|\n((?: {12}.*\n)+)/m)?.[1]
			.trim(),
		`type=raw,value=\${{ steps.tag.outputs.tag }}`,
	);
	assert.equal(step("Move :latest").condition, "steps.latest.outputs.move == 'true'");
	assert.doesNotMatch(release, /^ {4,8}continue-on-error: (?!false\s*$)/m);
	assert.deepEqual(
		step("Create GitHub Release")
			.text.match(/^ {10}files: \|\n((?: {12}.*\n)+)/m)?.[1]
			.trim()
			.split(/\n\s*/),
		["install.sh", "update.sh", "uninstall.sh", "SHA256SUMS"],
	);
});

for (const scenario of [
	{ name: "final tag push", event: "push", tag: "v0.7.3", latest: true },
	{ name: "old-tag dispatch repair", event: "workflow_dispatch", tag: "v0.7.3", latest: false },
	{ name: "prerelease tag push", event: "push", tag: "v0.8.0-rc.1", latest: false },
	{ name: "prerelease dispatch", event: "workflow_dispatch", tag: "v0.8.0-rc.1", latest: false },
]) {
	test(`Release ${scenario.name}: verifies shipped assets before promoting the identical digest`, async (t) => {
		const result = await fixture(t, scenario);
		assert.equal(result.failure, undefined, JSON.stringify(result.failure));
		assert.deepEqual(
			result.calls.map((call) => call.kind),
			[
				"checksums",
				"stage",
				"metadata",
				"sign",
				"verify",
				"promote",
				...(scenario.latest ? ["promote"] : []),
			],
		);
		const staged = result.calls.find((call) => call.kind === "stage");
		assert.deepEqual(staged.tags, [`${repository}:build-4242-3`]);
		assert.deepEqual(
			staged.images,
			children.map((child) => `${repository}@sha256:${child}`),
		);
		assert.equal(result.outputs.build.digest, digest);
		assert.equal(result.calls.find((call) => call.kind === "sign").image, signed);
		assert.deepEqual(result.calls.find((call) => call.kind === "verify").args, [
			signed,
			`${repository}@sha256:${children[0]}`,
			result.workspace,
		]);
		const promoted = result.calls.filter((call) => call.kind === "promote");
		assert.deepEqual(promoted[0], {
			kind: "promote",
			tags: [`${repository}:${scenario.tag}`],
			images: [signed],
		});
		if (scenario.latest)
			assert.deepEqual(promoted[1], {
				kind: "promote",
				tags: [`${repository}:latest`],
				images: [signed],
			});
		assert.equal(result.outputs.latest.move, String(scenario.latest));
		const sums = await readFile(path.join(result.workspace, "SHA256SUMS"), "utf8");
		for (const file of ["install.sh", "update.sh", "uninstall.sh"]) {
			const hash = createHash("sha256")
				.update(await readFile(path.join(result.workspace, file)))
				.digest("hex");
			assert.ok(sums.includes(`${hash}  ${file}\n`));
		}
	});
}

for (const [mode, failedStep, status] of [
	["metadata-invalid", "Stage the manifest list", 1],
	["metadata-missing", "Stage the manifest list", 1],
	["metadata-file-missing", "Stage the manifest list", 1],
	["sign-failure", "Sign the image (keyless)", 41],
	["verify-failure", "Verify both shipped installers against this signed digest", 42],
]) {
	test(`Release ${mode}: preserves the failure and never promotes a public tag`, async (t) => {
		const result = await fixture(t, { mode });
		assert.equal(result.failure?.step, failedStep, JSON.stringify(result.failure));
		assert.equal(result.failure.status, status, result.failure.output);
		assert.deepEqual(
			result.calls.filter((call) => call.kind === "promote"),
			[],
		);
		assert.equal(result.executed.at(-1), failedStep);
	});
}
