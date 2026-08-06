import { Command } from "commander";
import { apiGet } from "../client.js";
import { printJson } from "../utils/output.js";

type LogChunk = {
	deploymentId: string;
	status: string;
	log: string;
	offset: number;
	done: boolean;
};

async function followLogs(params: {
	deploymentId?: string;
	applicationId?: string;
	follow: boolean;
}): Promise<void> {
	let offset = 0;
	let deploymentId = params.deploymentId;

	for (;;) {
		const chunk = await apiGet<LogChunk>("deployment.getLogs", {
			deploymentId,
			applicationId: deploymentId ? undefined : params.applicationId,
			offset: String(offset),
		});
		deploymentId = chunk.deploymentId;
		if (chunk.log) {
			process.stdout.write(chunk.log);
		}
		offset = chunk.offset;
		if (!params.follow || chunk.done) {
			if (!params.follow && !chunk.log) {
				printJson({ deploymentId: chunk.deploymentId, status: chunk.status, empty: true });
			}
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
}

export function deployCommand(): Command {
	const deploy = new Command("deploy").description("Deployment helpers");

	deploy
		.command("logs")
		.description("Print (and optionally follow) deployment build logs")
		.argument("[deploymentId]", "Deployment ID (or use --application-id)")
		.option("--application-id <id>", "Use the latest deployment of this application")
		.option("-f, --follow", "Follow log output until the deployment finishes")
		.action(
			async (
				deploymentId: string | undefined,
				options: { applicationId?: string; follow?: boolean },
			) => {
				if (!deploymentId && !options.applicationId) {
					throw new Error("Provide a deploymentId argument or --application-id");
				}
				await followLogs({
					deploymentId,
					applicationId: options.applicationId,
					follow: Boolean(options.follow),
				});
			},
		);

	return deploy;
}
