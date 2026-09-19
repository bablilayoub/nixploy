import { assertSafeOutboundUrl, pinnedFetch, type SafeTarget } from "../../utils/public-url";
import { badRequest, unauthorized } from "../errors";
import type { DatabaseServiceKind } from "../services/registry";
import type { SourceReader } from "./reader";
import {
	type SourceApplication,
	type SourceCompose,
	type SourceDatabase,
	type SourceProjectSummary,
	sourceApplicationSchema,
	sourceComposeSchema,
	sourceDatabaseSchema,
	sourceProjectListSchema,
} from "./source-schema";

/**
 * The source panel's REST API, reached the only way tenant-supplied hosts
 * are reached from this process: the URL is vetted once (`assertSafeOutboundUrl`,
 * private ranges only when the instance allows private egress) and every
 * request dials the vetted addresses (`pinnedFetch`), so a DNS rebinding
 * between two calls goes nowhere. The API key lives on this object for the
 * duration of one plan or apply and is never written anywhere.
 */

const REQUEST_TIMEOUT_MS = 30_000;
/** A compose file or a long env can be large; a project list of a busy panel larger. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface SourceClientOptions {
	/** Panel origin, e.g. `https://panel.example.com`. A path is ignored. */
	url: string;
	apiKey: string;
}

export class SourcePanelClient implements SourceReader {
	private constructor(
		private readonly target: SafeTarget,
		private readonly apiKey: string,
	) {}

	static async connect(options: SourceClientOptions): Promise<SourcePanelClient> {
		const target = await assertSafeOutboundUrl(options.url, {
			allowPrivate: true,
			allowHttp: true,
		});
		return new SourcePanelClient(target, options.apiKey);
	}

	/** Host the requests go to, for audit rows and messages (never the key). */
	get host(): string {
		return this.target.url.host;
	}

	private async get(
		procedure: string,
		input: Record<string, string | number> = {},
	): Promise<unknown> {
		const url = new URL(`/api/${procedure}`, this.target.url.origin);
		for (const [key, value] of Object.entries(input)) {
			url.searchParams.set(key, String(value));
		}
		const response = await pinnedFetch(
			{ ...this.target, url },
			{
				method: "GET",
				headers: { accept: "application/json", "x-api-key": this.apiKey },
				timeoutMs: REQUEST_TIMEOUT_MS,
				maxBytes: MAX_RESPONSE_BYTES,
			},
		);
		if (response.status === 401 || response.status === 403) {
			throw unauthorized(
				`The source panel rejected the API key (${response.status} on ${procedure})`,
			);
		}
		if (!response.ok) {
			throw badRequest(
				`The source panel answered ${response.status} for ${procedure}: ${response.body.slice(0, 200)}`,
			);
		}
		try {
			return response.json();
		} catch {
			throw badRequest(`The source panel did not answer ${procedure} with JSON`);
		}
	}

	/** Every project the key can see, with environments and service ids. */
	async listProjects(): Promise<SourceProjectSummary[]> {
		const parsed = sourceProjectListSchema.safeParse(await this.get("project.all"));
		if (!parsed.success) {
			throw badRequest(
				`The source panel's project list has an unexpected shape: ${parsed.error.issues[0]?.message ?? "invalid"}`,
			);
		}
		return parsed.data;
	}

	async getApplication(applicationId: string): Promise<SourceApplication> {
		return parseOne(
			sourceApplicationSchema,
			await this.get("application.one", { applicationId }),
			"application",
		);
	}

	async getCompose(composeId: string): Promise<SourceCompose> {
		return parseOne(sourceComposeSchema, await this.get("compose.one", { composeId }), "compose");
	}

	async getDatabase(kind: DatabaseServiceKind, id: string): Promise<SourceDatabase> {
		return parseOne(
			sourceDatabaseSchema,
			await this.get(`${kind}.one`, { [`${kind}Id`]: id }),
			kind,
		);
	}

	/** Nothing to release: every request was its own connection. */
	async close(): Promise<void> {}
}

const parseOne = <T>(
	schema: {
		safeParse: (
			value: unknown,
		) =>
			| { success: true; data: T }
			| { success: false; error: { issues: Array<{ message: string; path: PropertyKey[] }> } };
	},
	value: unknown,
	label: string,
): T => {
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw badRequest(
			`The source panel's ${label} row has an unexpected shape${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}`,
		);
	}
	return parsed.data;
};
