import type { Command } from "commander";
import { api, apiPost } from "../client.js";
import { usageError } from "../errors.js";
import { addOutputOptions, printList, printResult } from "../utils/output.js";

export const TAGGABLE_SERVICE_TYPES = [
	"application",
	"compose",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
] as const;

export function augmentTagCommand(tag: Command): Command {
	addOutputOptions(
		tag
			.command("set")
			.description("Replace every tag on a service")
			.requiredOption("--service-type <type>", `One of: ${TAGGABLE_SERVICE_TYPES.join(", ")}`)
			.requiredOption("--service-id <id>", "Service ID")
			.option("--tag-id <id...>", "Tag IDs to assign (omit to clear)"),
	).action(async (options: { serviceType: string; serviceId: string; tagId?: string[] }) => {
		if (!(TAGGABLE_SERVICE_TYPES as readonly string[]).includes(options.serviceType)) {
			throw usageError(
				`Invalid --service-type. Expected one of: ${TAGGABLE_SERVICE_TYPES.join(", ")}`,
			);
		}
		const result = await apiPost("tag.setServiceTags", {
			type: options.serviceType,
			serviceId: options.serviceId,
			tagIds: options.tagId ?? [],
		});
		printResult(result, `Assigned ${options.tagId?.length ?? 0} tag(s).`);
	});

	addOutputOptions(
		tag
			.command("rename")
			.description("Rename or recolour a tag")
			.argument("<tagId>", "Tag ID")
			.option("--name <name>", "New name")
			.option("--color <hex>", "New hex color (#RRGGBB)"),
	).action(async (tagId: string, options: { name?: string; color?: string }) => {
		if (!options.name && !options.color) {
			throw usageError("Provide --name and/or --color");
		}
		const updated = await apiPost("tag.update", {
			tagId,
			...(options.name ? { name: options.name } : {}),
			...(options.color ? { color: options.color } : {}),
		});
		printResult(updated, "Tag updated.");
	});

	addOutputOptions(
		tag
			.command("services")
			.description("List the tags assigned to one or more services")
			.requiredOption("--service-type <type>", `One of: ${TAGGABLE_SERVICE_TYPES.join(", ")}`)
			.requiredOption("--service-id <id...>", "Service IDs"),
	).action(async (options: { serviceType: string; serviceId: string[] }) => {
		const rows = await api("tag.forServices", {
			method: "GET",
			query: {
				input: JSON.stringify({ type: options.serviceType, serviceIds: options.serviceId }),
			},
		});
		printList(rows, ["serviceId", "tagId", "name", "color"]);
	});

	return tag;
}
