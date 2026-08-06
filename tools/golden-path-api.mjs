#!/usr/bin/env node
/**
 * Golden-path API smoke: project → docker-image whoami → domain → deploy → HTTP.
 *
 *   NIXPLOY_URL=http://127.0.0.1:3000 \
 *   NIXPLOY_API_KEY=np_… \
 *   node tools/golden-path-api.mjs
 */

const BASE = (process.env.NIXPLOY_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const API_KEY = process.env.NIXPLOY_API_KEY;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);

if (!API_KEY) {
	console.error("NIXPLOY_API_KEY is required");
	process.exit(1);
}

function unwrap(data) {
	if (
		data &&
		typeof data === "object" &&
		"result" in data &&
		data.result &&
		typeof data.result === "object" &&
		"data" in data.result
	) {
		return data.result.data;
	}
	return data;
}

async function api(method, path, body) {
	const url = new URL(`${BASE}/api/${path}`);
	const res = await fetch(url, {
		method,
		headers: {
			"content-type": "application/json",
			"x-api-key": API_KEY,
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
	}
	if (!res.ok) {
		throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
	}
	return unwrap(data);
}

async function apiGet(path, input) {
	const url = new URL(`${BASE}/api/${path}`);
	if (input) url.searchParams.set("input", JSON.stringify(input));
	const res = await fetch(url, {
		headers: { "x-api-key": API_KEY },
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
	}
	if (!res.ok) {
		throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 500)}`);
	}
	return unwrap(data);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const stamp = Date.now().toString(36);

	const project = await api("POST", "project.create", {
		name: `smoke-${stamp}`,
		description: "golden-path CI",
	});
	const projectId = project.projectId;
	console.log("project", projectId);

	const envs = await apiGet("environment.byProject", { projectId });
	const environmentId = (Array.isArray(envs) ? envs : envs?.environments)?.[0]?.environmentId;
	if (!environmentId) {
		throw new Error("No environment on project");
	}
	console.log("environment", environmentId);

	const application = await api("POST", "application.create", {
		name: `whoami-${stamp}`,
		projectId,
		environmentId,
	});
	const applicationId = application.applicationId;
	console.log("application", applicationId);

	await api("POST", "application.saveSource", {
		applicationId,
		sourceType: "docker",
		dockerImage: "traefik/whoami:v1.10.1",
	});

	const host = process.env.SMOKE_HOST ?? `whoami-${stamp}.traefik.me`;
	await api("POST", "domain.create", {
		applicationId,
		host,
		https: true,
		certificateType: "none",
		port: 80,
	});
	console.log("domain", host);

	const deploy = await api("POST", "application.deploy", { applicationId });
	console.log("deploy", deploy.deploymentId);

	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		const code = await fetch(`http://${host}/`, { redirect: "manual" })
			.then((res) => res.status)
			.catch(() => 0);
		const httpsCode = await fetch(`https://${host}/`, { redirect: "manual" })
			.then((res) => res.status)
			.catch(() => 0);
		console.log("probe", { http: code, https: httpsCode });
		if ([200, 301, 302].includes(code) || [200, 301, 302].includes(httpsCode)) {
			console.log("GOLDEN PATH OK", { host, applicationId });
			return;
		}
		await sleep(4000);
	}
	throw new Error(`Timed out waiting for ${host}`);
}

main().catch((error) => {
	console.error("golden-path failed:", error);
	process.exit(1);
});
