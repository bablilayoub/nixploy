import type { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { usageError } from "../errors.js";
import { addOutputOptions, printList, printResult } from "../utils/output.js";

/**
 * Backup destinations (S3-compatible or the panel's own disk) and the schedule
 * creator. `destination.create` is a discriminated union on `provider`, which
 * the registry cannot express, and `backup.create` needs the same union on
 * `databaseType`.
 */
export function augmentBackupCommand(backup: Command): Command {
	const destination = backup
		.command("destination")
		.description("Backup storage destinations (S3-compatible or local disk)");

	addOutputOptions(destination.command("list").description("List backup destinations")).action(
		async () => {
			const rows = await apiGet("destination.all");
			printList(rows, ["destinationId", "name", "provider", "bucket", "region", "endpoint"]);
		},
	);

	addOutputOptions(
		destination
			.command("add")
			.description("Add a backup destination")
			.requiredOption("--name <name>", "Display name")
			.option("--provider <provider>", "s3 | local", "s3")
			.option("--bucket <bucket>", "S3 bucket")
			.option("--region <region>", "S3 region")
			.option("--endpoint <url>", "S3 endpoint, e.g. https://s3.eu-west-1.amazonaws.com")
			.option("--access-key <key>", "S3 access key id")
			.option("--secret-key <key>", "S3 secret access key (visible in `ps` — prefer the panel UI)"),
	).action(
		async (options: {
			name: string;
			provider: string;
			bucket?: string;
			region?: string;
			endpoint?: string;
			accessKey?: string;
			secretKey?: string;
		}) => {
			if (options.provider === "local") {
				const created = await apiPost<{ destinationId: string }>("destination.create", {
					provider: "local",
					name: options.name,
				});
				printResult(created, `Local destination created (${created.destinationId}).`);
				return;
			}
			const missing = (["bucket", "region", "endpoint", "accessKey", "secretKey"] as const).filter(
				(key) => !options[key],
			);
			if (missing.length > 0) {
				throw usageError(
					`--provider s3 needs ${missing.map((key) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).join(", ")}`,
				);
			}
			const created = await apiPost<{ destinationId: string }>("destination.create", {
				provider: "s3",
				name: options.name,
				bucket: options.bucket,
				region: options.region,
				endpoint: options.endpoint,
				accessKey: options.accessKey,
				secretAccessKey: options.secretKey,
			});
			printResult(created, `S3 destination created (${created.destinationId}).`);
		},
	);

	addOutputOptions(
		destination
			.command("test")
			.description("Verify credentials by listing the destination")
			.argument("<destinationId>", "Destination ID"),
	).action(async (destinationId: string) => {
		const result = await apiPost("destination.testConnection", { destinationId });
		printResult(result, "Destination reachable.");
	});

	addOutputOptions(
		destination
			.command("remove")
			.description("Delete a backup destination")
			.argument("<destinationId>", "Destination ID")
			.option("-y, --yes", "Confirm the destructive action (required)"),
	).action(async (destinationId: string, options: { yes?: boolean }) => {
		if (!options.yes) {
			throw usageError("`backup destination remove` is destructive — re-run with --yes.");
		}
		const result = await apiPost("destination.remove", { destinationId });
		printResult(result, "Destination removed.");
	});

	addOutputOptions(
		backup
			.command("create")
			.description("Create a backup schedule for a database service or the instance itself")
			.requiredOption("--destination-id <id>", "Backup destination")
			.requiredOption("--schedule <cron>", "Cron expression, e.g. '0 3 * * *'")
			.requiredOption("--database <name>", "Database to dump (use 'nixploy' for --type web-server)")
			.requiredOption("--type <type>", "postgres | mysql | mariadb | mongo | redis | web-server")
			.option("--service-id <id>", "Database service ID (required unless --type web-server)")
			.option("--prefix <prefix>", "Object key prefix")
			.option("--keep <n>", "Keep only the newest N dumps")
			.option("--disabled", "Create the schedule without enabling it"),
	).action(
		async (options: {
			destinationId: string;
			schedule: string;
			database: string;
			type: string;
			serviceId?: string;
			prefix?: string;
			keep?: string;
			disabled?: boolean;
		}) => {
			if (options.type !== "web-server" && !options.serviceId) {
				throw usageError("--service-id is required unless --type web-server");
			}
			const keepLatestCount = options.keep ? Number(options.keep) : undefined;
			if (keepLatestCount !== undefined && !Number.isInteger(keepLatestCount)) {
				throw usageError("--keep expects an integer");
			}
			const created = await apiPost<{ backupId: string }>("backup.create", {
				destinationId: options.destinationId,
				schedule: options.schedule,
				database: options.database,
				databaseType: options.type,
				...(options.serviceId ? { serviceId: options.serviceId } : {}),
				...(options.prefix ? { prefix: options.prefix } : {}),
				...(keepLatestCount !== undefined ? { keepLatestCount } : {}),
				enabled: options.disabled !== true,
			});
			printResult(created, `Backup schedule created (${created.backupId}).`);
		},
	);

	return backup;
}
