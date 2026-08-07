import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { printJson, printList } from "../utils/output.js";

const SERVICE_TYPES = [
	"application",
	"compose",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
] as const;

export function tagCommand(): Command {
	const tag = new Command("tag").description("Manage organization tags and service assignments");

	tag
		.command("list")
		.description("List tags in the active organization")
		.option("--json", "Print raw JSON")
		.action(async (options: { json?: boolean }) => {
			const rows = await apiGet("tag.all");
			printList(rows, ["tagId", "name", "color"], options);
		});

	tag
		.command("create")
		.description("Create a tag")
		.requiredOption("--name <name>", "Tag name")
		.option("--color <hex>", "Hex color (#RRGGBB)")
		.option("--json", "Print raw JSON")
		.action(async (options: { name: string; color?: string; json?: boolean }) => {
			const created = await apiPost("tag.create", {
				name: options.name,
				color: options.color,
			});
			if (options.json) {
				printJson(created);
			} else {
				printJson({ ok: true, tag: created });
			}
		});

	tag
		.command("set")
		.description("Replace all tags on a service")
		.requiredOption("--service-type <type>", `One of: ${SERVICE_TYPES.join(", ")}`)
		.requiredOption("--service-id <id>", "Service ID")
		.option("--tag-id <id...>", "Tag IDs to assign (omit to clear)")
		.option("--json", "Print raw JSON")
		.action(
			async (options: {
				serviceType: string;
				serviceId: string;
				tagId?: string[];
				json?: boolean;
			}) => {
				if (!(SERVICE_TYPES as readonly string[]).includes(options.serviceType)) {
					throw new Error(`Invalid --service-type. Expected one of: ${SERVICE_TYPES.join(", ")}`);
				}
				const result = await apiPost("tag.setServiceTags", {
					type: options.serviceType,
					serviceId: options.serviceId,
					tagIds: options.tagId ?? [],
				});
				if (options.json) {
					printJson(result);
				} else {
					printJson({ ok: true, assigned: options.tagId?.length ?? 0 });
				}
			},
		);

	return tag;
}
