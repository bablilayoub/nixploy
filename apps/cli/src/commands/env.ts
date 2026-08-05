import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { printJson } from "../utils/output.js";

const SERVICE_ROUTERS = {
	app: "application",
	compose: "compose",
	postgres: "postgres",
	mysql: "mysql",
	mariadb: "mariadb",
	mongo: "mongo",
	redis: "redis",
} as const;

type ServiceType = keyof typeof SERVICE_ROUTERS;

interface ApplicationLike {
	applicationId: string;
	env: string;
}

function parsePairs(pairs: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const pair of pairs) {
		const index = pair.indexOf("=");
		if (index <= 0) {
			throw new Error(`Invalid KEY=VALUE pair: "${pair}"`);
		}
		result[pair.slice(0, index)] = pair.slice(index + 1);
	}
	return result;
}

function serializeEnv(env: Record<string, string>): string {
	return Object.entries(env)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
}

function deserializeEnv(env: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of env.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("#")) {
			continue;
		}
		const index = trimmed.indexOf("=");
		if (index > 0) {
			result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
		}
	}
	return result;
}

export function envCommand(): Command {
	const env = new Command("env").description("Manage service environment variables");

	env
		.command("list")
		.description("List environment variables of a service")
		.argument("<applicationId>", "Service ID")
		.option("--type <type>", `Service type (${Object.keys(SERVICE_ROUTERS).join("|")})`, "app")
		.action(async (id: string, options: { type: ServiceType }) => {
			const router = SERVICE_ROUTERS[options.type];
			const service = await apiGet<{ env?: string }>(`${router}.one`, {
				[`${router}Id`]: id,
			});
			process.stdout.write(service.env ?? "");
			if (service.env && !service.env.endsWith("\n")) {
				process.stdout.write("\n");
			}
		});

	env
		.command("set")
		.description("Set environment variables on a service (KEY=VALUE pairs, merged with existing)")
		.argument("<applicationId>", "Service ID")
		.argument("<pairs...>", "KEY=VALUE pairs")
		.option("--type <type>", `Service type (${Object.keys(SERVICE_ROUTERS).join("|")})`, "app")
		.option("--replace", "Replace all variables instead of merging")
		.option("--json", "Print raw JSON")
		.action(
			async (
				id: string,
				pairs: string[],
				options: { type: ServiceType; replace?: boolean; json?: boolean },
			) => {
				const router = SERVICE_ROUTERS[options.type];
				const idParam = `${router}Id`;

				let merged = parsePairs(pairs);
				if (!options.replace) {
					const service = await apiGet<ApplicationLike>(`${router}.one`, {
						[idParam]: id,
					});
					merged = { ...deserializeEnv(service.env ?? ""), ...merged };
				}

				const result = await apiPost(`${router}.saveEnvironment`, {
					[idParam]: id,
					env: serializeEnv(merged),
				});
				printJson(options.json ? result : { ok: true, set: Object.keys(parsePairs(pairs)) });
			},
		);

	return env;
}
