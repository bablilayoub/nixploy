import { readFile } from "node:fs/promises";
import { readAllStdin } from "./prompt.js";

/** Read a path, or stdin when the path is `-` (pipe-friendly for CI). */
export async function readFileOrStdin(path: string): Promise<string> {
	return path === "-" ? await readAllStdin() : await readFile(path, "utf8");
}
