import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { printJson, printList } from "../utils/output.js";

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

function parseDomains(
	values: string[],
): Array<{ host: string; serviceName: string; port: number }> {
	return values.map((value) => {
		// host:service:port
		const parts = value.split(":");
		if (parts.length < 3) {
			throw new Error(`Invalid --domain (expected host:service:port): "${value}"`);
		}
		const port = Number(parts[parts.length - 1]);
		const serviceName = parts[parts.length - 2];
		const host = parts.slice(0, -2).join(":");
		if (!host || !serviceName || !Number.isInteger(port) || port < 1 || port > 65535) {
			throw new Error(`Invalid --domain (expected host:service:port): "${value}"`);
		}
		return { host, serviceName, port };
	});
}

export function templateCommand(): Command {
	const template = new Command("template").description("Browse and deploy catalog templates");

	template
		.command("list")
		.description("List templates in the catalog")
		.option("--json", "Print raw JSON")
		.action(async (options: { json?: boolean }) => {
			const rows = await apiGet("template.all");
			printList(rows, ["id", "name", "category"], options);
		});

	template
		.command("one")
		.description("Show one template including compose body and env schema")
		.argument("<templateId>", "Template ID")
		.option("--json", "Print raw JSON")
		.action(async (templateId: string, options: { json?: boolean }) => {
			const row = await apiGet("template.one", { templateId });
			if (options.json) {
				printJson(row);
				return;
			}
			printList([row], ["id", "name", "category"], options);
		});

	template
		.command("deploy")
		.description("Deploy a template into a project environment")
		.argument("<templateId>", "Template ID")
		.requiredOption("--project-id <id>", "Project ID")
		.requiredOption("--env <name>", "Environment name")
		.option(
			"--var <pair>",
			"Template env KEY=VALUE (repeatable)",
			(value: string, previous: string[]) => {
				previous.push(value);
				return previous;
			},
			[] as string[],
		)
		.option(
			"--domain <spec>",
			"Domain as host:service:port (repeatable)",
			(value: string, previous: string[]) => {
				previous.push(value);
				return previous;
			},
			[] as string[],
		)
		.option("--json", "Print raw JSON")
		.action(
			async (
				templateId: string,
				options: {
					projectId: string;
					env: string;
					var: string[];
					domain: string[];
					json?: boolean;
				},
			) => {
				const pairs = options.var ?? [];
				const domainSpecs = options.domain ?? [];
				const envValues = pairs.length > 0 ? parsePairs(pairs) : undefined;
				const domains = domainSpecs.length > 0 ? parseDomains(domainSpecs) : undefined;
				const result = await apiPost("template.deploy", {
					templateId,
					projectId: options.projectId,
					environmentName: options.env,
					envValues,
					domains,
				});
				printJson(options.json ? result : { ok: true, result });
			},
		);

	return template;
}
