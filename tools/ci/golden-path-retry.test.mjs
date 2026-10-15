import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const current = readFileSync(new URL("../golden-path-api.mjs", import.meta.url), "utf8");
// Exercise the actual smoke client's request/error boundary without running
// infrastructure. The release compatibility patch must have the same behavior.
const release = execFileSync("git", ["show", "v0.7.3:tools/golden-path-api.mjs"], {
	encoding: "utf8",
}).replaceAll("text.slice(0, 600)", "String(data?.message ?? text).slice(0, 600)");

for (const [name, source] of [
	["current", current],
	["release compatibility", release],
]) {
	const requestSource = source.slice(
		source.indexOf("async function request("),
		source.indexOf("const post ="),
	);
	const matcher = source.match(/const NOT_READY =\s*(\/[^\n]+\/i);/);
	assert.ok(matcher, "the smoke must retain its bounded readiness retry");
	const isNotReady = new Function(`return ${matcher[1]}`)();
	const request = (response) =>
		new Function(
			"fetch",
			"fail",
			`
		const BASE = "https://smoke.invalid", API_KEY = "test";
		const unwrap = (value) => value.result.data;
		${requestSource}
		return request;
	`,
		)(
			async () => response,
			(message) => {
				throw new Error(message);
			},
		);

	test(`${name}: decoded missing-database error reaches the readiness retry`, async () => {
		const message = 'pg_dump: FATAL: database "smokedb" does not exist';
		await assert.rejects(
			request(Response.json({ message }, { status: 400 }))("POST", "backup.runManually"),
			(error) => {
				assert.ok(error.message.includes(message));
				assert.ok(isNotReady.test(error.message));
				return true;
			},
		);
	});

	test(`${name}: unrelated and non-JSON errors remain failures`, async () => {
		for (const response of [
			Response.json({ message: "permission denied" }, { status: 403 }),
			new Response("bad gateway", { status: 502 }),
		]) {
			await assert.rejects(request(response)("POST", "backup.runManually"), (error) => {
				assert.equal(isNotReady.test(error.message), false);
				return true;
			});
		}
	});

	test(`${name}: successful REST payload is preserved`, async () => {
		assert.deepEqual(
			await request(Response.json({ result: { data: { ok: true } } }))("GET", "backup.runs"),
			{ ok: true },
		);
	});
}
