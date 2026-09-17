import type { Command } from "commander";
import { augmentAppCommand } from "./app.js";
import { auditCommand } from "./audit.js";
import { authCommand } from "./auth.js";
import { augmentBackupCommand } from "./backup.js";
import { augmentComposeCommand } from "./compose.js";
import { copilotCommand } from "./copilot.js";
import { dbCommand } from "./db.js";
import { deploymentCommand, legacyDeployCommand } from "./deployment.js";
import { doctorCommand } from "./doctor.js";
import { augmentDomainCommand } from "./domain.js";
import { envCommand } from "./env.js";
import { eventsCommand } from "./events.js";
import { gitopsCommand, registerGitopsTopLevelCommands } from "./gitops.js";
import { augmentOrgCommand } from "./org.js";
import { buildRegistryGroups } from "./registry.js";
import { augmentTagCommand } from "./tag.js";
import { augmentTemplateCommand } from "./template.js";

/**
 * Command assembly: the allow-list table in `registry.ts` generates one
 * sub-command per exposed procedure, then the hand-written modules bolt the
 * verbs that need real logic onto the same groups. Groups with no registry row
 * at all (`db`, `env`, `deployment`, `audit`, `auth`) are built entirely by
 * hand.
 */

/** Hand-written verbs added to generated groups, keyed by group name. */
const AUGMENTERS: Record<string, (group: Command) => Command> = {
	app: augmentAppCommand,
	backup: augmentBackupCommand,
	compose: augmentComposeCommand,
	domain: augmentDomainCommand,
	org: augmentOrgCommand,
	tag: augmentTagCommand,
	template: augmentTemplateCommand,
};

export function registerCommands(program: Command): Command {
	const groups = buildRegistryGroups();
	for (const [name, augment] of Object.entries(AUGMENTERS)) {
		const group = groups.get(name);
		if (group) augment(group);
	}

	// Fully hand-written groups.
	const bespoke = [
		authCommand(),
		dbCommand(),
		envCommand(),
		deploymentCommand(),
		auditCommand(),
		eventsCommand(),
		copilotCommand(),
		doctorCommand(),
		gitopsCommand(),
		legacyDeployCommand(),
	];

	const ordered = [...groups.values(), ...bespoke].sort((a, b) => a.name().localeCompare(b.name()));
	for (const command of ordered) {
		program.addCommand(command);
	}

	registerGitopsTopLevelCommands(program);
	return program;
}
