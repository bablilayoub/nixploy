"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { SettingsSection } from "@/components/layout/settings-section";
import { CopyButton } from "@/components/services/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Connect an agent to this panel.
 *
 * The MCP endpoint has existed since the tools did, and the only way to learn
 * its URL was to read the docs — so this renders the exact config for the three
 * clients people actually use, with this instance's own origin filled in.
 *
 * The API key is deliberately a placeholder. Every client config here lands in
 * a file on disk, usually inside a git repository; pre-filling a live key would
 * be handing people a way to commit one by accident. The API keys card above is
 * where a key is minted, and it shows it exactly once.
 */

const KEY_PLACEHOLDER = "nxp_your_api_key";

interface ClientSnippet {
	id: string;
	label: string;
	file: string;
	snippet: (url: string) => string;
}

const CLIENTS: ClientSnippet[] = [
	{
		id: "claude-code",
		label: "Claude Code",
		file: "one command, or .mcp.json in the project",
		snippet: (url) =>
			`claude mcp add --transport http nixploy ${url} --header "x-api-key: ${KEY_PLACEHOLDER}"`,
	},
	{
		id: "cursor",
		label: "Cursor",
		file: "~/.cursor/mcp.json",
		snippet: (url) =>
			JSON.stringify(
				{
					mcpServers: {
						nixploy: { url, headers: { "x-api-key": KEY_PLACEHOLDER } },
					},
				},
				null,
				2,
			),
	},
	{
		id: "codex",
		label: "Codex",
		file: "~/.codex/config.toml",
		snippet: (url) =>
			[
				"[mcp_servers.nixploy]",
				`url = "${url}"`,
				"",
				"[mcp_servers.nixploy.headers]",
				`"x-api-key" = "${KEY_PLACEHOLDER}"`,
			].join("\n"),
	},
];

export function McpSetupCard() {
	// The panel is reached on whatever origin the operator configured (and
	// through Traefik in production), so it is read from the browser rather
	// than from a build-time constant — and only after mount, because the
	// server render has no window to read it from.
	const [origin, setOrigin] = useState<string | null>(null);
	useEffect(() => {
		setOrigin(window.location.origin);
	}, []);
	const endpoint = `${origin ?? "https://your-panel"}/api/mcp`;

	return (
		<SettingsSection
			wide
			title="Connect an agent (MCP)"
			description="This panel speaks the Model Context Protocol. An agent gets the same tools you have — the same organization, the same capabilities, the same audit trail — and nothing more."
			actions={
				<Link
					href="https://nixploy.com/agents.md"
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
				>
					Agent guide
					<ExternalLink className="size-3.5" />
				</Link>
			}
		>
			<div className="flex flex-col gap-4">
				<div className="flex items-center gap-2">
					<code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
						{endpoint}
					</code>
					<CopyButton value={endpoint} label="Copy the MCP endpoint" variant="outline" />
				</div>

				<Tabs defaultValue={CLIENTS[0]?.id} className="w-full gap-3">
					<TabsList>
						{CLIENTS.map((client) => (
							<TabsTrigger key={client.id} value={client.id}>
								{client.label}
							</TabsTrigger>
						))}
					</TabsList>
					{CLIENTS.map((client) => {
						const snippet = client.snippet(endpoint);
						return (
							<TabsContent key={client.id} value={client.id} className="mt-0">
								<div className="flex items-start gap-2">
									<pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs">
										<code>{snippet}</code>
									</pre>
									<CopyButton value={snippet} label={`Copy the ${client.label} config`} />
								</div>
								<p className="mt-2 text-xs text-muted-foreground">{client.file}</p>
							</TabsContent>
						);
					})}
				</Tabs>

				<p className="text-sm text-muted-foreground">
					Replace <code className="font-mono text-xs">{KEY_PLACEHOLDER}</code> with a key from the
					card above. These files usually live in a git repository, so the key is a placeholder on
					purpose.
				</p>
			</div>
		</SettingsSection>
	);
}
