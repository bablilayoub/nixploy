import type { Command } from "commander";
import { apiPost } from "../client.js";
import { usageError } from "../errors.js";
import { parsePairs } from "../utils/env.js";
import { addOutputOptions, printResult } from "../utils/output.js";

/** `host:service:port` → the domain shape `template.deploy` expects. */
export function parseDomains(
	values: string[],
): Array<{ host: string; serviceName: string; port: number }> {
	return values.map((value) => {
		const parts = value.split(":");
		if (parts.length < 3) {
			throw usageError(`Invalid --domain (expected host:service:port): "${value}"`);
		}
		const port = Number(parts[parts.length - 1]);
		const serviceName = parts[parts.length - 2];
		const host = parts.slice(0, -2).join(":");
		if (!host || !serviceName || !Number.isInteger(port) || port < 1 || port > 65535) {
			throw usageError(`Invalid --domain (expected host:service:port): "${value}"`);
		}
		return { host, serviceName, port };
	});
}

const collect = (value: string, previous: string[]): string[] => {
	previous.push(value);
	return previous;
};

export function augmentTemplateCommand(template: Command): Command {
	addOutputOptions(
		template
			.command("deploy")
			.description("Deploy a catalog template into a project environment")
			.argument("<templateId>", "Template ID")
			.requiredOption("--project-id <id>", "Project ID")
			.requiredOption("--env <name>", "Environment name")
			.option("--var <pair>", "Template env KEY=VALUE (repeatable)", collect, [] as string[])
			.option(
				"--domain <spec>",
				"Domain as host:service:port (repeatable)",
				collect,
				[] as string[],
			),
	).action(
		async (
			templateId: string,
			options: { projectId: string; env: string; var: string[]; domain: string[] },
		) => {
			const pairs = options.var ?? [];
			const domainSpecs = options.domain ?? [];
			const result = await apiPost("template.deploy", {
				templateId,
				projectId: options.projectId,
				environmentName: options.env,
				envValues: pairs.length > 0 ? parsePairs(pairs) : undefined,
				domains: domainSpecs.length > 0 ? parseDomains(domainSpecs) : undefined,
			});
			printResult(result, `Template ${templateId} deployed.`);
		},
	);

	return template;
}
