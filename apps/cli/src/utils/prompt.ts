import { createInterface } from "node:readline";

/**
 * Read a secret without ever putting it on the command line: piped stdin when
 * the CLI is not attached to a terminal (`echo $KEY | nixploy auth login …`),
 * a no-echo prompt otherwise. Process arguments are world-readable in `ps`,
 * so `--api-key` stays a deprecated escape hatch.
 */
export async function readSecret(prompt: string): Promise<string> {
	if (!process.stdin.isTTY) {
		return (await readAllStdin()).trim();
	}
	return await promptHidden(prompt);
}

export async function readAllStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Terminal prompt with echo disabled; Ctrl-C still aborts the process. */
function promptHidden(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const input = process.stdin;
		const output = process.stderr;
		output.write(prompt);

		const rl = createInterface({ input, output, terminal: true });
		// Suppress echo: readline writes through this hook, we drop everything
		// except the prompt itself.
		const asMutable = rl as unknown as { _writeToOutput?: (text: string) => void };
		asMutable._writeToOutput = () => {};

		rl.question("", (answer) => {
			rl.close();
			output.write("\n");
			resolve(answer.trim());
		});
		rl.on("SIGINT", () => {
			rl.close();
			output.write("\n");
			reject(new Error("Aborted"));
		});
	});
}
