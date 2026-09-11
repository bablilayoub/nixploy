/**
 * Regenerates `src/lib/docs/api-catalog.ts` — the endpoint table rendered at
 * nixploy.com/api — from the live tRPC router.
 *
 * The catalog used to be hand-curated and drifted every sprint. It is now
 * mechanical: `generateOpenApiDocument()` walks `appRouter._def.procedures`
 * (nested routers included) and resolves each procedure's prose through
 * `packages/server/src/trpc/procedure-docs.ts`, which is the source of truth
 * for summaries and `x-nixploy-capability`. Every registered procedure
 * therefore appears on the page, with the same summary Swagger shows.
 *
 * Only summaries and capabilities are emitted — the full descriptions and the
 * input/output schemas stay on the panel's own `/swagger`, which is generated
 * from the version the operator actually runs. Mirroring 390 descriptions onto
 * a marketing page would quadruple the static HTML for content that is already
 * one click away and cannot go stale there.
 *
 * Re-run it after adding, renaming or removing a procedure (from anywhere in
 * the repo — `pnpm -F` runs with `packages/server` as the working directory,
 * which is what the `../../` is relative to):
 *
 *   pnpm -F @nixploy/server exec tsx ../../apps/landing/scripts/generate-api-catalog.mts
 *   pnpm exec biome check --write apps/landing/src/lib/docs/api-catalog.ts
 *
 * (`@nixploy/server` owns the `tsx` binary and the router; `apps/landing` has
 * no dev runtime of its own. The file extension is `.mts` on purpose —
 * `tsconfig.json` includes `**\/*.ts`, so a `.ts` script here would drag the
 * whole server package into the landing type-check.)
 *
 * It writes the file and prints a one-line diff summary; commit the result.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The server module graph asserts a real key at import time (see auth.md). */
process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** Human titles for the router tags; the tag itself is the fallback. */
const ROUTER_TITLES: Record<string, string> = {
	ai: "Deploy Copilot",
	application: "Applications",
	audit: "Audit log",
	backup: "Database backups",
	bitbucket: "Bitbucket",
	certificate: "Certificates",
	compose: "Compose & stacks",
	deployment: "Deployments",
	destination: "Backup destinations",
	docker: "Docker control center",
	domain: "Domains",
	environment: "Environments",
	gitea: "Gitea",
	github: "GitHub",
	gitlab: "GitLab",
	gitops: "GitOps",
	mariadb: "MariaDB",
	mongo: "MongoDB",
	monitoring: "Monitoring",
	mount: "Mounts",
	mysql: "MySQL",
	notification: "Notifications",
	observability: "Incidents & uptime",
	organization: "Organization",
	port: "Published ports",
	postgres: "PostgreSQL",
	previewDeployment: "Preview deployments",
	project: "Projects",
	redirect: "Redirects",
	redis: "Redis",
	registry: "Registries",
	rollback: "Rollbacks",
	schedule: "Schedules",
	security: "Basic auth",
	server: "Servers",
	setup: "Setup (public)",
	sshKey: "SSH keys",
	tag: "Tags",
	template: "Templates",
	traefik: "Traefik entrypoints",
	updates: "Updates",
	volumeBackup: "Volume backups",
	volumeFiles: "Volume files",
	webServer: "Panel & platform",
};

/**
 * Descriptions for routers `openapi.ts`'s own `TAG_DESCRIPTIONS` does not
 * cover yet. Drop an entry here once it grows one upstream.
 */
const EXTRA_ROUTER_DESCRIPTIONS: Record<string, string> = {
	traefik: "TCP and UDP entrypoints published on the proxy",
	volumeFiles: "Browse, read and edit files inside a Docker volume",
};

interface Operation {
	tags: string[];
	summary: string;
	"x-nixploy-capability"?: string[];
	"x-nixploy-instance-admin"?: boolean;
}

interface Endpoint {
	method: "GET" | "POST";
	path: string;
	summary: string;
	capability?: string[];
	instanceAdmin?: boolean;
}

function quote(value: string): string {
	return JSON.stringify(value);
}

async function main() {
	const { generateOpenApiDocument } = await import("../../../packages/server/src/trpc/openapi.ts");
	const doc = generateOpenApiDocument() as {
		tags: Array<{ name: string; description?: string }>;
		paths: Record<string, Record<string, Operation>>;
	};

	const descriptions = new Map(doc.tags.map((tag) => [tag.name, tag.description ?? ""]));
	const groups = new Map<string, Endpoint[]>();

	for (const [url, methods] of Object.entries(doc.paths)) {
		for (const [method, operation] of Object.entries(methods)) {
			const path = url.replace(/^\/api\//, "");
			const router = operation.tags[0] ?? path.split(".")[0] ?? "default";
			const endpoint: Endpoint = {
				method: method.toUpperCase() as "GET" | "POST",
				path,
				summary: operation.summary,
			};
			const capability = operation["x-nixploy-capability"];
			if (capability && capability.length > 0) endpoint.capability = [...capability];
			if (operation["x-nixploy-instance-admin"]) endpoint.instanceAdmin = true;

			const list = groups.get(router);
			if (list) list.push(endpoint);
			else groups.set(router, [endpoint]);
		}
	}

	const routers = [...groups.keys()].sort();
	let total = 0;

	const body = routers
		.map((router) => {
			const endpoints = (groups.get(router) ?? []).sort((a, b) => a.path.localeCompare(b.path));
			total += endpoints.length;
			const description =
				descriptions.get(router) ||
				EXTRA_ROUTER_DESCRIPTIONS[router] ||
				ROUTER_TITLES[router] ||
				router;
			const rows = endpoints
				.map((endpoint) => {
					const parts = [
						`method: ${quote(endpoint.method)}`,
						`path: ${quote(endpoint.path)}`,
						`summary: ${quote(endpoint.summary)}`,
					];
					if (endpoint.capability) {
						parts.push(`capability: [${endpoint.capability.map(quote).join(", ")}]`);
					}
					if (endpoint.instanceAdmin) parts.push("instanceAdmin: true");
					return `\t\t\t{ ${parts.join(", ")} },`;
				})
				.join("\n");
			return [
				"\t{",
				`\t\trouter: ${quote(router)},`,
				`\t\ttitle: ${quote(ROUTER_TITLES[router] ?? router)},`,
				`\t\tdescription: ${quote(description)},`,
				"\t\tendpoints: [",
				rows,
				"\t\t],",
				"\t},",
			].join("\n");
		})
		.join("\n");

	const file = `// Generated by apps/landing/scripts/generate-api-catalog.mts — do not edit by hand.
// Re-run: pnpm -F @nixploy/server exec tsx ../../apps/landing/scripts/generate-api-catalog.mts
//
// Source of truth: packages/server/src/trpc/procedure-docs.ts (summaries and
// capabilities) walked through the live appRouter, so every registered
// procedure is listed. Full descriptions and schemas live on the panel's own
// /swagger, which always matches the version that is installed.

export type ApiEndpoint = {
	method: "GET" | "POST";
	path: string;
	summary: string;
	/** Organization capabilities the key's user must hold. */
	capability?: string[];
	/** Also requires the instance admin (platform owner). */
	instanceAdmin?: boolean;
};

export type ApiRouterGroup = {
	router: string;
	title: string;
	description: string;
	endpoints: ApiEndpoint[];
};

/** Every REST endpoint the panel exposes, grouped by router. */
export const apiCatalog: ApiRouterGroup[] = [
${body}
];

/** Total endpoints in the catalog above. */
export const apiEndpointCount = ${total};
`;

	const out = fileURLToPath(new URL("../src/lib/docs/api-catalog.ts", import.meta.url));
	writeFileSync(out, file);
	console.log(`Wrote ${out}: ${routers.length} routers, ${total} endpoints.`);
	console.log("Run `pnpm exec biome check --write apps/landing/src/lib/docs/api-catalog.ts`.");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
