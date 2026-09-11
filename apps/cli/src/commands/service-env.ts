import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import {
	describeDiff,
	deserializeEnv,
	diffEnv,
	type EnvMap,
	parsePairs,
	serializeEnv,
} from "../utils/env.js";
import { readFileOrStdin } from "../utils/io.js";
import { addOutputOptions, printRaw, printResult } from "../utils/output.js";
import { readScopeEnv, requireEnv, type ServiceKind, writeScopeEnv } from "./env.js";

/**
 * `<group> env get|set|import|export <serviceId>` — the service-scoped slice of
 * the `env` group, attached to `app`, `compose` and `db` so the common case is
 * one word shorter than `env get --scope service --type … --service-id …`.
 */
export function addServiceEnvCommands(
	group: Command,
	kind: ServiceKind,
	label: string,
	description: string,
): Command {
	const env = group.command("env").description("Read and write environment variables");

	const scopeFor = (serviceId: string, type?: ServiceKind) =>
		({ scope: "service", serviceId, type: type ?? kind }) as const;

	addOutputOptions(
		env.command("get").description("Print the raw .env blob").argument(label, description),
	).action(async (serviceId: string, options: { type?: ServiceKind }) => {
		printRaw(await requireEnv(await readScopeEnv(scopeFor(serviceId, options.type))));
	});

	addOutputOptions(
		env
			.command("set")
			.description("Merge KEY=VALUE pairs into the service env")
			.argument(label, description)
			.argument("<pairs...>", "KEY=VALUE pairs")
			.option("--replace", "Replace every variable instead of merging"),
	).action(
		async (
			serviceId: string,
			pairs: string[],
			options: { replace?: boolean; type?: ServiceKind },
		) => {
			const scope = scopeFor(serviceId, options.type);
			const before: EnvMap = options.replace
				? {}
				: deserializeEnv(await requireEnv(await readScopeEnv(scope)));
			const after = { ...before, ...parsePairs(pairs) };
			await writeScopeEnv(scope, serializeEnv(after));
			const diff = diffEnv(before, after);
			printResult({ ok: true, ...diff }, `Environment updated: ${describeDiff(diff)}`);
		},
	);

	addOutputOptions(
		env
			.command("import")
			.description("Merge a local .env file into the service env")
			.argument(label, description)
			.requiredOption("-f, --file <path>", "Path to a .env file ('-' reads stdin)")
			.option("--replace", "Replace every variable instead of merging"),
	).action(
		async (serviceId: string, options: { file: string; replace?: boolean; type?: ServiceKind }) => {
			const scope = scopeFor(serviceId, options.type);
			const raw = await readFileOrStdin(options.file);
			const before: EnvMap = options.replace
				? {}
				: deserializeEnv(await requireEnv(await readScopeEnv(scope)));
			const after = { ...before, ...deserializeEnv(raw) };
			await writeScopeEnv(scope, serializeEnv(after));
			const diff = diffEnv(before, after);
			printResult({ ok: true, ...diff }, `Imported ${options.file}: ${describeDiff(diff)}`);
		},
	);

	addOutputOptions(
		env
			.command("export")
			.description("Write the service .env blob to a file or stdout")
			.argument(label, description)
			.option("-o, --output <path>", "Write to this file instead of stdout"),
	).action(async (serviceId: string, options: { output?: string; type?: ServiceKind }) => {
		const value = await requireEnv(await readScopeEnv(scopeFor(serviceId, options.type)));
		if (options.output) {
			await writeFile(options.output, value.endsWith("\n") ? value : `${value}\n`, "utf8");
			printResult({ ok: true, path: options.output }, `Wrote ${options.output}`);
			return;
		}
		printRaw(value);
	});

	return env;
}
