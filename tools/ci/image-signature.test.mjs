import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const verifier = path.join(root, "tools/ci/verify-image-signature.sh");
const checker = path.join(root, "tools/ci/check-installer-signatures.sh");
const repository = "ghcr.io/bablilayoub/nixploy";
const digest = `sha256:${"a".repeat(64)}`;
const signed = `${repository}@${digest}`;
const unsigned = `${repository}@sha256:${"b".repeat(64)}`;
const issuer = "https://token.actions.githubusercontent.com";
const workflow = "https://github.com/bablilayoub/nixploy/.github/workflows/";
const installers = ["install.sh", "update.sh"];

// This fake only supplies certificate/signature outcomes. The real shell blocks
// own repository selection, identity/issuer arguments, rejection and digest pinning.
async function fixture(t) {
	const directory = await mkdtemp(path.join(tmpdir(), "nixploy-image-signature-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const bin = path.join(directory, "bin");
	await mkdir(bin);
	const callsFile = path.join(directory, "calls.jsonl");
	await writeFile(
		path.join(bin, "cosign"),
		`#!/usr/bin/env node
const {appendFileSync} = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.SIGNATURE_TEST_CALLS, JSON.stringify(args) + "\\n");
const fail = (message, code = 1) => { console.error(message); process.exit(code); };
if (args[0] !== "verify") fail("Unexpected fake cosign command", 99);
if (process.env.SIGNATURE_TEST_MODE === "cannot-run") fail("cannot run", 126);
const identityIndex = args.indexOf("--certificate-identity-regexp");
const issuerIndex = args.indexOf("--certificate-oidc-issuer");
if (identityIndex < 0 || issuerIndex < 0) fail("Missing certificate policy", 99);
const image = args.at(-1);
if (image === process.env.SIGNATURE_TEST_UNSIGNED || process.env.SIGNATURE_TEST_MODE === "unsigned")
  fail("no signatures found");
if (!new RegExp(args[identityIndex + 1]).test(process.env.SIGNATURE_TEST_IDENTITY))
  fail("failed to verify certificate identity");
if (args[issuerIndex + 1] !== process.env.SIGNATURE_TEST_ISSUER)
  fail("failed to verify certificate issuer");
const imageClaim = process.env.SIGNATURE_TEST_MODE === "missing-digest"
  ? {} : {"docker-manifest-digest": process.env.SIGNATURE_TEST_DIGEST};
console.log(JSON.stringify([{critical: {image: imageClaim}}]));
`,
		{ mode: 0o700 },
	);
	const env = {
		...process.env,
		PATH: `${bin}${path.delimiter}${process.env.PATH}`,
		LOG_FILE: path.join(directory, "cosign.log"),
		NIXPLOY_CONFIG_DIR: path.join(directory, "config"),
		NIXPLOY_SKIP_VERIFY: "",
		NIXPLOY_SIGNED_IMAGE_REPO: "",
		NIXPLOY_SIGNING_IDENTITY_REGEXP: "",
		NIXPLOY_INSTALLER: "",
		SIGNATURE_TEST_CALLS: callsFile,
		SIGNATURE_TEST_IDENTITY: `${workflow}release.yml@refs/tags/v0.7.3`,
		SIGNATURE_TEST_ISSUER: issuer,
		SIGNATURE_TEST_DIGEST: digest,
		SIGNATURE_TEST_UNSIGNED: unsigned,
		SIGNATURE_TEST_MODE: "",
	};
	const run = (script, args, overrides = {}) => {
		const result = spawnSync("bash", [script, ...args], {
			cwd: directory,
			env: { ...env, ...overrides },
			encoding: "utf8",
			timeout: 10_000,
		});
		assert.ifError(result.error);
		return { ...result, output: `${result.stdout}${result.stderr}` };
	};
	return {
		directory,
		run,
		verify: (installer, image, overrides = {}) =>
			run(verifier, [image], { NIXPLOY_INSTALLER: path.join(root, installer), ...overrides }),
		calls: async () => {
			const contents = await readFile(callsFile, "utf8").catch((error) => {
				if (error.code === "ENOENT") return "";
				throw error;
			});
			return contents.trim() ? contents.trim().split("\n").map(JSON.parse) : [];
		},
	};
}

for (const installer of installers) {
	for (const identity of [
		`${workflow}release.yml@refs/tags/v0.7.3`,
		`${workflow}release.yml@refs/heads/main`,
		`${workflow}docker.yml@refs/heads/main`,
	]) {
		test(`${installer}: accepts the official ${identity.split("/workflows/")[1]} signer`, async (t) => {
			const setup = await fixture(t);
			const image = `${repository}:v0.7.3`;
			const result = setup.verify(installer, image, { SIGNATURE_TEST_IDENTITY: identity });
			assert.equal(result.status, 0, result.output);
			assert.equal(result.stdout.trim().split("\n").at(-1), `${image}@${digest}`);
			const [args] = await setup.calls();
			assert.equal(args[args.indexOf("--certificate-oidc-issuer") + 1], issuer);
		});
	}

	test(`${installer}: verifies and pins the bare official repository`, async (t) => {
		const setup = await fixture(t);
		const result = setup.verify(installer, repository);
		assert.equal(result.status, 0, result.output);
		assert.equal(result.stdout.trim().split("\n").at(-1), signed);
		assert.equal((await setup.calls()).length, 1);
	});

	test(`${installer}: canonicalizes accepted official GHCR host aliases before verification`, async (t) => {
		const setup = await fixture(t);
		for (const host of ["GHCR.IO", "ghcr.io:443", "GHCR.IO:443"]) {
			for (const suffix of ["", ":v0.7.3", `@${digest}`]) {
				const result = setup.verify(installer, `${host}/bablilayoub/nixploy${suffix}`);
				assert.equal(result.status, 0, result.output);
				const canonical = `${repository}${suffix}`;
				assert.equal(
					result.stdout.trim().split("\n").at(-1),
					suffix.startsWith("@") ? canonical : `${canonical}@${digest}`,
				);
			}
		}
		const calls = await setup.calls();
		assert.equal(calls.length, 9);
		assert.ok(calls.every((args) => args.at(-1).startsWith(`${repository}`)));
	});

	test(`${installer}: rejects ambiguous official-host forms with canonical guidance`, async (t) => {
		const setup = await fixture(t);
		for (const host of ["ghcr.io:0443", "ghcr.io.", "ghcr.io.:443", "GHCR.IO:444"]) {
			const result = setup.verify(installer, `${host}/bablilayoub/nixploy:main`);
			assert.equal(result.status, 1, result.output);
			assert.match(result.output, /Unsupported official image reference/);
			assert.ok(result.output.includes(repository));
		}
		assert.deepEqual(await setup.calls(), []);
	});

	for (const [name, overrides, message] of [
		["unsigned", { SIGNATURE_TEST_MODE: "unsigned" }, /Signature check FAILED/],
		[
			"foreign identity",
			{
				SIGNATURE_TEST_IDENTITY: `${workflow.replace("bablilayoub", "someone-else")}release.yml@refs/tags/v0.7.3`,
			},
			/Signature check FAILED/,
		],
		[
			"different workflow",
			{ SIGNATURE_TEST_IDENTITY: `${workflow}untrusted.yml@refs/heads/main` },
			/Signature check FAILED/,
		],
		["wrong issuer", { SIGNATURE_TEST_ISSUER: "https://issuer.invalid" }, /Signature check FAILED/],
		["missing digest", { SIGNATURE_TEST_MODE: "missing-digest" }, null],
		[
			"mismatched digest",
			{ SIGNATURE_TEST_DIGEST: `sha256:${"c".repeat(64)}` },
			/signature does not cover/,
		],
		["unusable cosign", { SIGNATURE_TEST_MODE: "cannot-run" }, /could not run \(exit 126\)/],
	]) {
		test(`${installer}: rejects ${name}`, async (t) => {
			const setup = await fixture(t);
			const result = setup.verify(installer, signed, overrides);
			assert.equal(result.status, 1, result.output);
			if (message) assert.match(result.output, message);
			assert.doesNotMatch(result.output, /Signature verified/);
			assert.equal((await setup.calls()).length, 1);
		});
	}

	test(`${installer}: preserves explicit bypass and foreign-image behavior`, async (t) => {
		const setup = await fixture(t);
		for (const [image, overrides] of [
			[repository, { NIXPLOY_SKIP_VERIFY: "1" }],
			["GHCR.IO:0443/bablilayoub/nixploy:main", { NIXPLOY_SKIP_VERIFY: "1" }],
			["registry.invalid/operator/panel:custom", {}],
			["GHCR.IO/operator/panel:custom", {}],
		]) {
			const result = setup.verify(installer, image, overrides);
			assert.equal(result.status, 0, result.output);
			assert.equal(result.stdout.trim().split("\n").at(-1), image);
		}
		assert.deepEqual(await setup.calls(), []);
	});

	test(`${installer}: preserves explicit repository and identity overrides`, async (t) => {
		const setup = await fixture(t);
		const image = "ghcr.io/operator/panel:custom";
		const result = setup.verify(installer, image, {
			NIXPLOY_SIGNED_IMAGE_REPO: "ghcr.io/operator/panel",
			NIXPLOY_SIGNING_IDENTITY_REGEXP: "^https://github\\.com/operator/panel/",
			SIGNATURE_TEST_IDENTITY:
				"https://github.com/operator/panel/.github/workflows/build.yml@refs/heads/main",
		});
		assert.equal(result.status, 0, result.output);
		assert.equal(result.stdout.trim().split("\n").at(-1), `${image}@${digest}`);
		assert.equal((await setup.calls()).length, 1);
	});

	test(`${installer}: canonicalizes an explicit official-repository alias override`, async (t) => {
		const setup = await fixture(t);
		const result = setup.verify(installer, "GHCR.IO:443/bablilayoub/nixploy:main", {
			NIXPLOY_SIGNED_IMAGE_REPO: "GHCR.IO:443/bablilayoub/nixploy",
		});
		assert.equal(result.status, 0, result.output);
		assert.equal(result.stdout.trim().split("\n").at(-1), `${repository}:main@${digest}`);
		assert.equal((await setup.calls()).length, 1);
	});
}

async function pinnedAssets(directory) {
	const assets = path.join(directory, "pinned release assets");
	await mkdir(assets);
	for (const installer of installers) {
		const source = await readFile(path.join(root, installer), "utf8");
		await writeFile(
			path.join(assets, installer),
			source.replace("#!/usr/bin/env bash\n", '#!/usr/bin/env bash\nNIXPLOY_VERSION="v0.7.3"\n'),
		);
	}
	return assets;
}

test("shared checker preserves the two-argument immutable-checkout path", async (t) => {
	const setup = await fixture(t);
	const result = setup.run(checker, [signed, unsigned]);
	assert.equal(result.status, 0, result.output);
	for (const installer of installers) {
		assert.ok(result.stdout.includes(`${installer} accepts ${signed}`));
		assert.ok(result.stdout.includes(`${installer} rejects foreign signature`));
		assert.ok(result.stdout.includes(`${installer} rejects unsigned signature`));
	}
	assert.equal((await setup.calls()).length, 6);
});

test("shared checker verifies supplied pinned assets without requiring helpers in that directory", async (t) => {
	const setup = await fixture(t);
	const assets = await pinnedAssets(setup.directory);
	const result = setup.run(checker, [signed, unsigned, assets]);
	assert.equal(result.status, 0, result.output);
	assert.equal((await setup.calls()).length, 6);
});

test("shared checker applies the supplied asset's policy instead of falling back to its checkout", async (t) => {
	const setup = await fixture(t);
	const assets = await pinnedAssets(setup.directory);
	const update = path.join(assets, "update.sh");
	const source = await readFile(update, "utf8");
	await writeFile(
		update,
		source.replace(
			"# ── end image signature",
			'SIGNING_IDENTITY_REGEXP="^https://github\\\\.com/someone-else/nixploy/"\n# ── end image signature',
		),
	);
	const result = setup.run(checker, [signed, unsigned, assets]);
	assert.equal(result.status, 1, result.output);
	assert.match(result.output, /Signature check FAILED/);
	assert.ok(result.stdout.includes(`install.sh accepts ${signed}`));
	assert.ok(!result.stdout.includes(`update.sh accepts ${signed}`));
});

for (const kind of [
	"missing directory",
	"empty directory argument",
	"missing installer",
	"unsupported old installer",
	"truncated signature block",
]) {
	test(`shared checker explicitly rejects ${kind}`, async (t) => {
		const setup = await fixture(t);
		const assets = path.join(setup.directory, "unusable assets");
		if (kind !== "missing directory" && kind !== "empty directory argument") {
			await mkdir(assets);
			await writeFile(
				path.join(assets, "install.sh"),
				await readFile(path.join(root, "install.sh")),
			);
			if (kind !== "missing installer") {
				await writeFile(
					path.join(assets, "update.sh"),
					kind === "unsupported old installer"
						? "#!/usr/bin/env bash\necho old installer without signature support\n"
						: "#!/usr/bin/env bash\n# ── image signature\n",
				);
			}
		}
		const result = setup.run(checker, [
			signed,
			unsigned,
			kind === "empty directory argument" ? "" : assets,
		]);
		assert.equal(result.status, 1, result.output);
		assert.match(
			result.output,
			/Missing installer (asset|directory)|Unsupported installer asset.*signature/,
		);
		assert.deepEqual(await setup.calls(), []);
	});
}
