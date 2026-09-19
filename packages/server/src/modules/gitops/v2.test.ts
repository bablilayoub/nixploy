import { describe, expect, it } from "vitest";
import { buildPlan, type LiveStackState, stackSensitivity } from "./plan";
import { itemsToRedeploy } from "./redeploy";
import {
	NIXPLOY_STACK_VERSION,
	type NixployStack,
	nixployStackSchema,
	parseStackYaml,
	upgradeStack,
} from "./schema";

const liveState = (overrides: Partial<LiveStackState> = {}): LiveStackState => ({
	projectId: "p1",
	environmentName: "prod",
	applications: [],
	compose: [],
	databases: { postgres: [], mysql: [], mariadb: [], mongo: [], redis: [] },
	...overrides,
});

const stack = (overrides: Partial<NixployStack> = {}): NixployStack => ({
	version: 2,
	project: { name: "demo" },
	...overrides,
});

describe("manifest v2 schema", () => {
	it("accepts a v1 file and upgrades it, spelling out the domains it left out", () => {
		const parsed = parseStackYaml(
			[
				"version: 1",
				"project:",
				"  name: demo",
				"applications:",
				"  - name: web",
				"    environment: prod",
				"compose:",
				"  - name: stack",
				"    environment: prod",
				"    domains:",
				"      - host: s.example.com",
			].join("\n"),
		);
		expect(parsed.version).toBe(NIXPLOY_STACK_VERSION);
		expect(parsed.applications?.[0]?.domains).toEqual([]);
		expect(parsed.compose?.[0]?.domains).toHaveLength(1);
	});

	it("leaves a v2 file alone", () => {
		const v2 = stack({ applications: [{ name: "web", environment: "prod" }] });
		expect(upgradeStack(v2)).toBe(v2);
		expect(upgradeStack(v2).applications?.[0]?.domains).toBeUndefined();
	});

	it("rejects an unknown version", () => {
		expect(nixployStackSchema.safeParse({ version: 3, project: { name: "x" } }).success).toBe(
			false,
		);
	});

	it("validates a middleware config against its kind at parse time", () => {
		const bad = nixployStackSchema.safeParse(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						domains: [
							{
								host: "a.example.com",
								middlewares: [{ kind: "rateLimit", config: { average: 0 } }],
							},
						],
					},
				],
			}),
		);
		expect(bad.success).toBe(false);
		expect(JSON.stringify(bad.error?.issues)).toContain("rateLimit");
		const good = nixployStackSchema.safeParse(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						domains: [
							{
								host: "a.example.com",
								middlewares: [{ kind: "rateLimit", config: { average: 10, burst: 20 } }],
							},
						],
					},
				],
			}),
		);
		expect(good.success).toBe(true);
	});

	it("requires the container name on compose mounts, redirects and basic auth", () => {
		const parsed = nixployStackSchema.safeParse(
			stack({
				compose: [
					{
						name: "stack",
						environment: "prod",
						mounts: [{ type: "volume", mountPath: "/data", volumeName: "stack-data" }],
						redirects: [{ regex: "^/old", replacement: "/new" }],
						basicAuth: [{ username: "ops", password: "x" }],
					},
				],
			}),
		);
		expect(parsed.success).toBe(false);
		const paths = parsed.error?.issues.map((issue) => issue.path.join("."));
		expect(paths).toContain("compose.0.mounts.0.serviceName");
		expect(paths).toContain("compose.0.redirects.0.serviceName");
		expect(paths).toContain("compose.0.basicAuth.0.serviceName");
	});

	it("requires the field a mount type needs", () => {
		const parsed = nixployStackSchema.safeParse(
			stack({
				applications: [
					{ name: "web", environment: "prod", mounts: [{ type: "bind", mountPath: "/x" }] },
				],
			}),
		);
		expect(parsed.success).toBe(false);
		expect(JSON.stringify(parsed.error?.issues)).toContain("hostPath is required");
	});
});

describe("buildPlan v2", () => {
	const web = (row: Record<string, unknown> = {}) =>
		liveState({
			applications: [
				{
					name: "web",
					appName: "web-a1b2c3",
					row,
					domains: [],
					mounts: [
						{
							type: "volume",
							mountPath: "/data",
							hostPath: null,
							volumeName: "web-a1b2c3-data",
							filePath: null,
							content: undefined,
							serviceName: null,
						},
					],
					ports: [{ published: 8080, target: 80, protocol: "tcp", publishMode: "ingress" }],
					redirects: [{ regex: "^/old", replacement: "/new", permanent: false, serviceName: null }],
					basicAuth: [{ username: "ops", serviceName: null }],
				},
			],
		});

	it("leaves every child collection alone when the manifest omits it", () => {
		const plan = buildPlan(stack({ applications: [{ name: "web", environment: "prod" }] }), web());
		expect(plan.items).toHaveLength(1);
		expect(plan.items[0]).toMatchObject({ kind: "application", action: "noop" });
	});

	it("reconciles mounts, ports, redirects and basic auth by their keys", () => {
		const plan = buildPlan(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						mounts: [
							{ type: "volume", mountPath: "/data", volumeName: "web-a1b2c3-data" },
							{ type: "volume", mountPath: "/cache", volumeName: "web-a1b2c3-cache" },
						],
						ports: [{ published: 8080, target: 8080 }],
						redirects: [],
						basicAuth: [{ username: "ops" }, { username: "dev", password: "s3cret" }],
					},
				],
			}),
			web(),
		);
		const byKind = (kind: string) =>
			plan.items.filter((item) => item.kind === kind).map((item) => [item.name, item.action]);
		expect(byKind("mount")).toEqual([
			["/data", "noop"],
			["/cache", "create"],
		]);
		expect(byKind("port")).toEqual([["8080→8080/tcp", "update"]]);
		expect(byKind("redirect")).toEqual([["^/old", "delete"]]);
		expect(byKind("basicAuth")).toEqual([
			["ops", "noop"],
			["dev", "create"],
		]);
		expect(plan.items.every((item) => !item.parent || item.parentKind === "application")).toBe(
			true,
		);
		expect(plan.summary).toEqual({ create: 2, update: 1, delete: 1, noop: 3 });
	});

	it("diffs the nested groups against their columns and reports manifest paths", () => {
		const plan = buildPlan(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						hooks: { preDeploy: "npm run migrate" },
						swarm: { restartPolicy: { Condition: "on-failure", MaxAttempts: 3 } },
						previews: { limit: 5 },
					},
				],
			}),
			web({
				preDeployCommand: "npm run migrate",
				// jsonb comes back with its own key order; that must not count.
				restartPolicySwarm: { MaxAttempts: 3, Condition: "on-failure" },
				previewLimit: 3,
			}),
		);
		expect(plan.items[0]?.changes).toEqual(["previews.limit"]);
	});

	it("reports a middleware chain change on the domain item", () => {
		const live = liveState({
			applications: [
				{
					name: "web",
					appName: "web-a1b2c3",
					row: {},
					domains: [
						{
							host: "a.example.com",
							path: "/",
							port: null,
							https: true,
							certificateType: "letsencrypt",
							middlewares: [{ kind: "compress", config: {}, enabled: true }],
						},
					],
				},
			],
		});
		const unchanged = buildPlan(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						domains: [{ host: "a.example.com", middlewares: [{ kind: "compress" }] }],
					},
				],
			}),
			live,
		);
		expect(unchanged.items.find((item) => item.kind === "domain")?.action).toBe("noop");
		const changed = buildPlan(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						domains: [
							{
								host: "a.example.com",
								middlewares: [{ kind: "rateLimit", config: { average: 10, burst: 20 } }],
							},
						],
					},
				],
			}),
			live,
		);
		expect(changed.items.find((item) => item.kind === "domain")?.changes).toEqual(["middlewares"]);
	});

	it("treats references by name as plain fields", () => {
		const plan = buildPlan(
			stack({
				applications: [{ name: "web", environment: "prod", registry: "ghcr", server: null }],
			}),
			web({ registry: "ghcr", server: "builder" }),
		);
		expect(plan.items[0]?.changes).toEqual(["server"]);
	});
});

describe("stackSensitivity", () => {
	it("is quiet for a plain stack", () => {
		expect(
			stackSensitivity(stack({ applications: [{ name: "web", environment: "prod" }] })),
		).toEqual({ secrets: false, instanceAdmin: [] });
	});

	it("names what needs secrets.write and the instance admin", () => {
		const result = stackSensitivity(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						hooks: { preDeploy: "x" },
						mounts: [{ type: "bind", mountPath: "/x", hostPath: "/srv/x" }],
						swarm: { network: [{ Target: "nixploy-network" }] },
					},
				],
				compose: [{ name: "stack", environment: "prod", publishPorts: true }],
			}),
		);
		expect(result.secrets).toBe(true);
		expect(result.instanceAdmin).toEqual([
			"application web: bind mounts",
			"application web: swarm.network",
			"compose stack: publishPorts",
		]);
	});
});

describe("itemsToRedeploy", () => {
	it("redeploys a compose stack whose mounts changed even when its row did not", () => {
		const result = {
			projectId: "p1",
			environmentName: "prod",
			summary: { create: 1, update: 0, delete: 0, noop: 2 },
			applied: 1,
			errors: [],
			items: [
				{ kind: "compose" as const, action: "noop" as const, name: "stack", environment: "prod" },
				{
					kind: "mount" as const,
					action: "create" as const,
					name: "web:/data",
					environment: "prod",
					parent: "stack",
					parentKind: "compose" as const,
				},
				{
					kind: "application" as const,
					action: "noop" as const,
					name: "stack",
					environment: "prod",
				},
				{
					kind: "port" as const,
					action: "create" as const,
					name: "8080→80/tcp",
					environment: "prod",
					parent: "stack",
					parentKind: "application" as const,
				},
			],
		};
		expect(itemsToRedeploy(result).map((item) => item.kind)).toEqual(["compose"]);
	});
});
